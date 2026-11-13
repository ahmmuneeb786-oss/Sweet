/**
 * On-device copies of chat images, so each one is downloaded at most once.
 *
 * Images are kept in Cache Storage (the same store the service worker uses,
 * but read and written directly from the page — so it also works in dev,
 * where there's no service worker). Chat media URLs are unique per upload
 * and never change, so a saved copy never goes stale.
 *
 *  - Sent images: the compressed file is saved right after upload, so the
 *    sender never downloads their own photo.
 *  - Received images: prefetched in the background as soon as the message
 *    arrives (prefetchChatImages), so they're already there when the chat
 *    opens — and work offline. Follows the Sugar Diet auto-download setting.
 *  - Anything else (older messages, a missed prefetch): saved the first time
 *    it's shown.
 *
 * Every saved image also gets a row in localDB.mediaIndex (size, chat, when
 * it was last viewed, keepsake flag). Cleanup reads that index: photos not
 * viewed within the user's "keep for" window go first, then the least
 * recently viewed until the total is under their limit. Keepsakes are never
 * removed.
 *
 * Images are handed to <img> as object URLs. Those keep the image bytes in
 * memory, so they're reference-counted and only a small number of unused
 * ones are kept around for instant re-display; the rest are released.
 */

import { resolveMediaUrl } from './signedMedia';
import { localDB, type LocalMediaEntry } from '../db';
import { getStoragePrefs, isMeteredConnection } from './storage/prefs';

export const MEDIA_CACHE_NAME = 'sweet-chat-media-v1';
const MAX_IDLE_OBJECT_URLS = 40; // decoded-ready copies kept in memory when not on screen
const DAY = 24 * 60 * 60 * 1000;

interface Entry {
  url: string;
  refs: number;
}

// Map keeps insertion order, which doubles as least-recently-used order
// (an entry is re-inserted whenever it's used).
const objectUrls = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

const hasCacheStorage = () => typeof window !== 'undefined' && 'caches' in window;

function evictIdleObjectUrls() {
  let idle = 0;
  for (const entry of objectUrls.values()) if (entry.refs === 0) idle++;
  for (const [src, entry] of objectUrls) {
    if (idle <= MAX_IDLE_OBJECT_URLS) break;
    if (entry.refs > 0) continue;
    URL.revokeObjectURL(entry.url);
    objectUrls.delete(src);
    idle--;
  }
}

// --- Index bookkeeping ---

async function indexSaved(src: string, bytes: number, source: LocalMediaEntry['source'], chatId?: string | null) {
  try {
    const now = Date.now();
    const existing = await localDB.mediaIndex.get(src);
    await localDB.mediaIndex.put({
      url: src,
      chat_id: chatId ?? existing?.chat_id ?? null,
      bytes,
      saved_at: existing?.saved_at ?? now,
      last_viewed: source === 'auto' ? existing?.last_viewed ?? now : now,
      source: existing?.source ?? source,
      keepsake: existing?.keepsake ?? 0,
    });
  } catch {
    // ignore — the index is rebuilt from Cache Storage by runMediaMaintenance
  }
}

// "Last viewed" updates are batched: scrolling a chat can show dozens of
// images a second, and one write per image would be wasteful.
const pendingTouches = new Map<string, number>();
let touchTimer: ReturnType<typeof setTimeout> | null = null;
function touch(src: string) {
  pendingTouches.set(src, Date.now());
  if (touchTimer) return;
  touchTimer = setTimeout(async () => {
    touchTimer = null;
    const batch = [...pendingTouches];
    pendingTouches.clear();
    try {
      await localDB.mediaIndex.bulkUpdate(batch.map(([key, t]) => ({ key, changes: { last_viewed: t } })));
    } catch {
      // ignore — only affects cleanup order
    }
  }, 3000);
}

let trimScheduled = false;
function scheduleTrim() {
  if (trimScheduled) return;
  trimScheduled = true;
  setTimeout(() => {
    trimScheduled = false;
    void enforceMediaPolicy().catch(() => {});
  }, 5000);
}

// --- Saving and reading ---

/** The saved copy, or download and save it. Null if neither works (offline + never saved). */
async function ensureSaved(src: string, source: 'auto' | 'viewed', chatId?: string | null): Promise<Response | null> {
  if (!hasCacheStorage()) return null;
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const hit = await cache.match(src);
  if (hit) {
    if (source === 'viewed') touch(src);
    return hit;
  }
  // Saved under the stable storage URL, downloaded via a signed one (chat
  // media buckets are private — see signedMedia.ts).
  const res = await fetch(await resolveMediaUrl(src), { mode: 'cors' });
  if (!res.ok) return null;
  const blob = await res.blob();
  await cache.put(src, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
  await indexSaved(src, blob.size, source, chatId);
  scheduleTrim();
  return new Response(blob);
}

/** The object URL for an image if it's already in memory — lets a re-render show it with no flash. */
export function peekMediaUrl(src: string): string | null {
  return objectUrls.get(src)?.url ?? null;
}

/**
 * Resolve an image to a displayable URL (saved copy if possible) and hold
 * it until releaseMediaUrl(src) is called. Falls back to the original URL
 * when Cache Storage isn't available or the image can't be fetched.
 *
 * Pass { touch: false } when showing it somewhere that isn't the user
 * actually looking at the chat (e.g. the storage manager's photo grid), so
 * it doesn't count as "viewed" for cleanup.
 */
export function acquireMediaUrl(src: string, opts: { touch?: boolean } = {}): Promise<string> {
  const shouldTouch = opts.touch !== false;
  const existing = objectUrls.get(src);
  if (existing) {
    existing.refs++;
    objectUrls.delete(src);
    objectUrls.set(src, existing); // mark most recently used
    if (shouldTouch) touch(src);
    return Promise.resolve(existing.url);
  }

  let pending = inflight.get(src);
  if (!pending) {
    pending = ensureSaved(src, shouldTouch ? 'viewed' : 'auto')
      .then((res) => (res ? res.blob() : null))
      .then((blob) => {
        if (!blob) return resolveMediaUrl(src);
        const entry = objectUrls.get(src) ?? { url: URL.createObjectURL(blob), refs: 0 };
        objectUrls.set(src, entry);
        return entry.url;
      })
      .catch(() => resolveMediaUrl(src))
      .finally(() => inflight.delete(src));
    inflight.set(src, pending);
  }

  return pending.then((url) => {
    const entry = objectUrls.get(src);
    if (entry) entry.refs++;
    return url;
  });
}

export function releaseMediaUrl(src: string) {
  const entry = objectUrls.get(src);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) evictIdleObjectUrls();
}

/** Save a file we already have (e.g. a just-sent photo) under its public URL. */
export async function saveMediaBlob(src: string, blob: Blob, chatId?: string | null) {
  if (!hasCacheStorage()) return;
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(src, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    await indexSaved(src, blob.size, 'sent', chatId);
    scheduleTrim();
  } catch {
    // ignore — it'll just be downloaded the first time it's shown
  }
}

// --- Background prefetch of newly received images ---

const prefetchQueue: { src: string; chatId: string | null }[] = [];
const queued = new Set<string>();
let activePrefetches = 0;
const MAX_PARALLEL_PREFETCHES = 2; // gentle on slow phones and networks

function pumpPrefetchQueue() {
  while (activePrefetches < MAX_PARALLEL_PREFETCHES && prefetchQueue.length > 0) {
    const { src, chatId } = prefetchQueue.shift()!;
    activePrefetches++;
    ensureSaved(src, 'auto', chatId) // no need to keep the bytes — just make sure they're saved
      .catch(() => null)
      .finally(() => {
        activePrefetches--;
        queued.delete(src);
        pumpPrefetchQueue();
      });
  }
}

/**
 * Download and save the images in these messages in the background, so a
 * chat opens with them already on the device. Follows the auto-download
 * setting (always / Wi-Fi only / never); always skipped on Data Saver.
 */
export function prefetchChatImages(messages: { type?: string | null; media_url?: string | null; is_deleted?: boolean | null; chat_id?: string | null }[]) {
  if (!hasCacheStorage() || !navigator.onLine) return;
  if ((navigator as any).connection?.saveData) return;
  const { autoDownload } = getStoragePrefs();
  if (autoDownload === 'never') return;
  if (autoDownload === 'wifi' && isMeteredConnection()) return;
  for (const m of messages) {
    const src = m.media_url;
    if (m.type !== 'image' || m.is_deleted || !src || !/^https?:/.test(src) || queued.has(src)) continue;
    queued.add(src);
    prefetchQueue.push({ src, chatId: m.chat_id ?? null });
  }
  pumpPrefetchQueue();
}

// --- Removal, keepsakes, cleanup ---

/**
 * Remove these images from the device. Keepsakes are skipped unless
 * `includeKeepsakes` — callers that let the user pick photos still never
 * pass it; a keepsake has to be un-hearted first. Returns bytes freed.
 */
export async function deleteMedia(urls: string[], opts: { includeKeepsakes?: boolean } = {}): Promise<{ count: number; bytes: number }> {
  if (urls.length === 0) return { count: 0, bytes: 0 };
  const rows = await localDB.mediaIndex.bulkGet(urls);
  const doomed = urls.filter((_, i) => opts.includeKeepsakes || rows[i]?.keepsake !== 1);
  const doomedSet = new Set(doomed);
  let bytes = 0;
  rows.forEach((r) => { if (r && doomedSet.has(r.url)) bytes += r.bytes; });

  if (hasCacheStorage()) {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    for (const url of doomed) await cache.delete(url);
  }
  await localDB.mediaIndex.bulkDelete(doomed);

  // Drop in-memory copies nobody is showing; ones on screen stay until released.
  for (const url of doomed) {
    const entry = objectUrls.get(url);
    if (entry && entry.refs === 0) {
      URL.revokeObjectURL(entry.url);
      objectUrls.delete(url);
    }
  }
  return { count: doomed.length, bytes };
}

/**
 * Heart / un-heart a photo. Hearting one that isn't on the device yet (e.g.
 * from the chat viewer before it finished saving) saves it first, so a
 * keepsake is always viewable offline. False if it couldn't be saved.
 */
export async function setKeepsake(url: string, on: boolean, chatId?: string | null): Promise<boolean> {
  let row = await localDB.mediaIndex.get(url);
  if (!row && on) {
    const saved = await ensureSaved(url, 'viewed', chatId).catch(() => null);
    if (!saved) return false;
    row = await localDB.mediaIndex.get(url);
    if (!row) return false;
  }
  if (!row) return true; // un-hearting something not saved — nothing to do
  await localDB.mediaIndex.update(url, {
    keepsake: on ? 1 : 0,
    ...(chatId && !row.chat_id ? { chat_id: chatId } : {}),
  });
  return true;
}

export async function isKeepsake(url: string): Promise<boolean> {
  return (await localDB.mediaIndex.get(url))?.keepsake === 1;
}

/**
 * Apply the Sugar Diet: remove photos not viewed within the "keep for"
 * window, then the least recently viewed until under the size limit.
 * Keepsakes are never touched. Returns what was removed.
 */
export async function enforceMediaPolicy(): Promise<{ count: number; bytes: number }> {
  const plan = await planMediaPolicy();
  return deleteMedia(plan.urls);
}

/**
 * Dry run of enforceMediaPolicy — what it would remove under these settings
 * (the saved ones by default). Lets Sugar Diet show the effect of a stricter
 * setting before it's applied.
 */
export async function planMediaPolicy(
  prefs: { keepDays: number; maxPhotoMB: number } = getStoragePrefs()
): Promise<{ urls: string[]; count: number; bytes: number }> {
  const { keepDays, maxPhotoMB } = prefs;
  const rows = await localDB.mediaIndex.toArray();
  const cap = maxPhotoMB * 1024 * 1024;
  const now = Date.now();

  const doomed = new Set<string>();
  let total = rows.reduce((sum, r) => sum + r.bytes, 0);

  const candidates = rows.filter((r) => r.keepsake !== 1).sort((a, b) => a.last_viewed - b.last_viewed);
  if (keepDays > 0) {
    for (const r of candidates) {
      if (r.last_viewed < now - keepDays * DAY) {
        doomed.add(r.url);
        total -= r.bytes;
      }
    }
  }
  for (const r of candidates) {
    if (total <= cap) break;
    if (doomed.has(r.url)) continue;
    doomed.add(r.url);
    total -= r.bytes;
  }
  const urls = [...doomed];
  const bytes = rows.reduce((s, r) => s + (doomed.has(r.url) ? r.bytes : 0), 0);
  return { urls, count: urls.length, bytes };
}

/**
 * Keep the index in step with Cache Storage: index images saved before the
 * index existed (or by an older version), drop rows whose image the browser
 * removed, and fill in missing chat ids from the message cache. Measures
 * sizes one image at a time and yields between them, so it never janks.
 */
export async function syncMediaIndex(): Promise<void> {
  if (!hasCacheStorage()) return;
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const cachedUrls = (await cache.keys()).map((r) => r.url);
  const cachedSet = new Set(cachedUrls);
  const indexedUrls = (await localDB.mediaIndex.toCollection().primaryKeys()) as string[];
  const indexedSet = new Set(indexedUrls);

  const orphaned = indexedUrls.filter((u) => !cachedSet.has(u));
  if (orphaned.length) await localDB.mediaIndex.bulkDelete(orphaned);

  const missing = cachedUrls.filter((u) => !indexedSet.has(u));
  for (let i = 0; i < missing.length; i++) {
    const res = await cache.match(missing[i]);
    if (!res) continue;
    const size = Number(res.headers.get('content-length')) || (await res.blob()).size;
    // saved_at 0 = "saved before the index existed": unknown date, so the
    // forecast leaves it out of the growth rate.
    await localDB.mediaIndex.put({
      url: missing[i], chat_id: null, bytes: size, saved_at: 0, last_viewed: Date.now(), source: 'viewed', keepsake: 0,
    });
    if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
  }

  // Match photos with no chat yet (null) against the message cache — once.
  // Ones that can't be matched get '' so later launches don't rescan every
  // message for them (still filed under "Locked & hidden chats").
  const unsorted = await localDB.mediaIndex.filter((r) => r.chat_id === null).toArray();
  if (unsorted.length) {
    const want = new Set(unsorted.map((r) => r.url));
    const chatByUrl = new Map<string, string>();
    const messages = await localDB.messages.toArray();
    for (const m of messages) {
      if (m.media_url && want.has(m.media_url)) chatByUrl.set(m.media_url, m.chat_id);
    }
    await localDB.mediaIndex.bulkUpdate(
      unsorted.map((r) => ({ key: r.url, changes: { chat_id: chatByUrl.get(r.url) ?? '' } }))
    );
  }
}
