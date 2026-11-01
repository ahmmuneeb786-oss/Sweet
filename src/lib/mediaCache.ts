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
 *    opens — and work offline.
 *  - Anything else (older messages, a missed prefetch): saved the first time
 *    it's shown.
 *
 * Images are handed to <img> as object URLs. Those keep the image bytes in
 * memory, so they're reference-counted and only a small number of unused
 * ones are kept around for instant re-display; the rest are released.
 */

const CACHE_NAME = 'sweet-chat-media-v1';
const MAX_CACHED_IMAGES = 800; // ~200MB at the usual compressed size
const MAX_IDLE_OBJECT_URLS = 40; // decoded-ready copies kept in memory when not on screen

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

let trimScheduled = false;
function scheduleTrim() {
  if (trimScheduled) return;
  trimScheduled = true;
  setTimeout(async () => {
    trimScheduled = false;
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys(); // oldest first
      const excess = keys.length - MAX_CACHED_IMAGES;
      for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
    } catch {
      // ignore — trimming is housekeeping only
    }
  }, 5000);
}

/** The saved copy, or download and save it. Null if neither works (offline + never saved). */
async function ensureSaved(src: string): Promise<Response | null> {
  if (!hasCacheStorage()) return null;
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(src);
  if (hit) return hit;
  const res = await fetch(src, { mode: 'cors' });
  if (!res.ok) return null;
  await cache.put(src, res.clone());
  scheduleTrim();
  return res;
}

async function getBlob(src: string): Promise<Blob | null> {
  const res = await ensureSaved(src);
  return res ? res.blob() : null;
}

/** The object URL for an image if it's already in memory — lets a re-render show it with no flash. */
export function peekMediaUrl(src: string): string | null {
  return objectUrls.get(src)?.url ?? null;
}

/**
 * Resolve an image to a displayable URL (saved copy if possible) and hold
 * it until releaseMediaUrl(src) is called. Falls back to the original URL
 * when Cache Storage isn't available or the image can't be fetched.
 */
export function acquireMediaUrl(src: string): Promise<string> {
  const existing = objectUrls.get(src);
  if (existing) {
    existing.refs++;
    objectUrls.delete(src);
    objectUrls.set(src, existing); // mark most recently used
    return Promise.resolve(existing.url);
  }

  let pending = inflight.get(src);
  if (!pending) {
    pending = getBlob(src)
      .then((blob) => {
        if (!blob) return src;
        const entry = objectUrls.get(src) ?? { url: URL.createObjectURL(blob), refs: 0 };
        objectUrls.set(src, entry);
        return entry.url;
      })
      .catch(() => src)
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
export async function saveMediaBlob(src: string, blob: Blob) {
  if (!hasCacheStorage()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(src, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    scheduleTrim();
  } catch {
    // ignore — it'll just be downloaded the first time it's shown
  }
}

// --- Background prefetch of newly received images ---

const prefetchQueue: string[] = [];
const queued = new Set<string>();
let activePrefetches = 0;
const MAX_PARALLEL_PREFETCHES = 2; // gentle on slow phones and networks

function pumpPrefetchQueue() {
  while (activePrefetches < MAX_PARALLEL_PREFETCHES && prefetchQueue.length > 0) {
    const src = prefetchQueue.shift()!;
    activePrefetches++;
    ensureSaved(src) // no need to read the bytes — just make sure they're saved
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
 * chat opens with them already on the device. Skipped on Data Saver.
 */
export function prefetchChatImages(messages: { type?: string | null; media_url?: string | null; is_deleted?: boolean | null }[]) {
  if (!hasCacheStorage() || !navigator.onLine) return;
  if ((navigator as any).connection?.saveData) return;
  for (const m of messages) {
    const src = m.media_url;
    if (m.type !== 'image' || m.is_deleted || !src || !/^https?:/.test(src) || queued.has(src)) continue;
    queued.add(src);
    prefetchQueue.push(src);
  }
  pumpPrefetchQueue();
}
