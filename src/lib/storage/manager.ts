/**
 * Storage manager behind the Storage & Media tab ("Candy Jar").
 *
 * What it will and won't touch:
 *  - Photos (Cache Storage + localDB.mediaIndex): clearable, except keepsakes.
 *  - Message cache (localDB.messages): clearable, except messages still on
 *    their way out (sending / pending / failed, or anything in the outbox).
 *  - Never: the outbox (pendingMessages), chats list, vault, profiles with
 *    unsynced edits, the app's own files and Face Lock models.
 */
import { localDB, type LocalChat, type LocalMediaEntry } from '../../db';
import { deleteMedia, enforceMediaPolicy, syncMediaIndex } from '../mediaCache';
import { readStorage, writeStorage } from '../safeStorage';
import { recordSnapshot } from './forecast';

const DAY = 24 * 60 * 60 * 1000;
/** Shelf key for chats we won't name or open here: locked, unknown, unsorted. */
export const PRIVATE_SHELF_KEY = '__private__';

export interface StorageSummary {
  usage: number | null; // whole origin, from the browser
  quota: number | null;
  persisted: boolean | null; // null = browser can't tell us
  photos: { count: number; bytes: number; keepsakes: number; keepsakeBytes: number };
  messages: { count: number; bytes: number };
  waiting: { count: number; bytes: number };
  other: number; // app files, Face Lock models, settings — managed by the app itself
}

export type CleanTarget =
  | { kind: 'photos'; shelfKey?: string; olderThanDays?: number; neverOpened?: boolean; urls?: string[] }
  | { kind: 'messages'; shelfKey?: string; olderThanDays?: number };

export interface CleanPreview {
  count: number;
  bytes: number;
  keptKeepsakes: number; // photos matching the filter that stay because they're hearted
  keptUnsent: number; // messages matching the filter that stay because they haven't been sent
  sampleUrls: string[]; // a few photos about to go, for the preview strip
}

export interface ShelfRow {
  key: string; // chat id, or PRIVATE_SHELF_KEY
  name: string;
  avatar: string | null;
  isPrivate: boolean;
  photoCount: number;
  photoBytes: number;
  keepsakes: number;
  messageCount: number;
  messageBytes: number;
}

// --- helpers ---

const UNSENT = new Set(['sending', 'pending', 'failed']);

// Message sizes are estimated from a sample (stringifying every cached
// message would be slow on low-end phones). The sample is cached briefly,
// since one screen asks for it several times.
let avgCache: { value: number; at: number } | null = null;
async function avgMessageBytes(): Promise<number> {
  if (avgCache && Date.now() - avgCache.at < 30_000) return avgCache.value;
  const sample = await localDB.messages.limit(150).toArray();
  const value = sample.length ? sample.reduce((s, m) => s + JSON.stringify(m).length, 0) / sample.length : 0;
  avgCache = { value, at: Date.now() };
  return value;
}

function chatName(c: LocalChat): string {
  if (c.type === 'direct') return c.other_user_name || c.name || 'Chat';
  return c.name || 'Group chat';
}

/** Chat ids that can be shown by name here — known and not in the vault. */
async function visibleChats(): Promise<Map<string, LocalChat>> {
  const chats = await localDB.chats.toArray();
  return new Map(chats.filter((c) => !c.is_locked).map((c) => [c.id, c]));
}

function inShelf(chatId: string | null, shelfKey: string | undefined, visible: Map<string, LocalChat>) {
  if (!shelfKey) return true;
  if (shelfKey === PRIVATE_SHELF_KEY) return !chatId || !visible.has(chatId);
  return chatId === shelfKey;
}

// --- summary ---

export async function getStorageSummary(): Promise<StorageSummary> {
  const [estimate, persisted, media, messageCount, avg, pending] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
    navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
    localDB.mediaIndex.toArray(),
    localDB.messages.count(),
    avgMessageBytes(),
    localDB.pendingMessages.toArray(),
  ]);

  const photos = { count: media.length, bytes: 0, keepsakes: 0, keepsakeBytes: 0 };
  for (const m of media) {
    photos.bytes += m.bytes;
    if (m.keepsake === 1) {
      photos.keepsakes++;
      photos.keepsakeBytes += m.bytes;
    }
  }
  const messages = { count: messageCount, bytes: Math.round(messageCount * avg) };
  const waiting = {
    count: pending.length,
    bytes: pending.reduce((s, p) => s + (p.media_blob?.size ?? 0) + (p.content?.length ?? 0), 0),
  };
  const usage = estimate?.usage ?? null;
  const other = usage === null ? 0 : Math.max(0, usage - photos.bytes - messages.bytes - waiting.bytes);

  return { usage, quota: estimate?.quota ?? null, persisted, photos, messages, waiting, other };
}

// --- cleaning ---

async function photoCandidates(t: Extract<CleanTarget, { kind: 'photos' }>) {
  const visible = await visibleChats();
  const now = Date.now();
  let rows: LocalMediaEntry[] = t.urls
    ? ((await localDB.mediaIndex.bulkGet(t.urls)).filter(Boolean) as LocalMediaEntry[])
    : await localDB.mediaIndex.toArray();
  rows = rows.filter((r) => inShelf(r.chat_id, t.shelfKey, visible));
  if (t.olderThanDays) rows = rows.filter((r) => r.last_viewed < now - t.olderThanDays! * DAY);
  if (t.neverOpened) rows = rows.filter((r) => r.source === 'auto' && r.last_viewed === r.saved_at);
  return { rows, visible };
}

async function messageCandidates(t: Extract<CleanTarget, { kind: 'messages' }>) {
  const visible = await visibleChats();
  const outbox = new Set((await localDB.pendingMessages.toCollection().primaryKeys()) as string[]);
  const cutoff = t.olderThanDays ? new Date(Date.now() - t.olderThanDays * DAY).toISOString() : null;
  // One chat: read just its rows through the chat_id index. Otherwise one
  // bulk read, which is much faster than a cursor walk on slow devices.
  const rows =
    t.shelfKey && t.shelfKey !== PRIVATE_SHELF_KEY
      ? await localDB.messages.where('chat_id').equals(t.shelfKey).toArray()
      : await localDB.messages.toArray();
  let keptUnsent = 0;
  const ids: string[] = [];
  for (const m of rows) {
    if (!inShelf(m.chat_id, t.shelfKey, visible)) continue;
    if (cutoff && m.created_at >= cutoff) continue;
    if (UNSENT.has(m.delivery_status ?? '') || outbox.has(m.id)) {
      keptUnsent++;
      continue;
    }
    ids.push(m.id);
  }
  return { ids, keptUnsent };
}

export async function previewClean(t: CleanTarget): Promise<CleanPreview> {
  if (t.kind === 'photos') {
    const { rows, visible } = await photoCandidates(t);
    const going = rows.filter((r) => r.keepsake !== 1);
    return {
      count: going.length,
      bytes: going.reduce((s, r) => s + r.bytes, 0),
      keptKeepsakes: rows.length - going.length,
      keptUnsent: 0,
      // Thumbnails only from chats that may be shown here — never the vault.
      sampleUrls: going
        .filter((r) => r.chat_id && visible.has(r.chat_id))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 6)
        .map((r) => r.url),
    };
  }
  const [{ ids, keptUnsent }, avg] = await Promise.all([messageCandidates(t), avgMessageBytes()]);
  return { count: ids.length, bytes: Math.round(ids.length * avg), keptKeepsakes: 0, keptUnsent, sampleUrls: [] };
}

export async function clean(t: CleanTarget, userId?: string | null): Promise<{ count: number; bytes: number }> {
  if (t.kind === 'photos') {
    const { rows } = await photoCandidates(t);
    return deleteMedia(rows.map((r) => r.url));
  }
  const [{ ids }, avg] = await Promise.all([messageCandidates(t), avgMessageBytes()]);
  // Delete in chunks so a huge clear doesn't hold one long transaction.
  for (let i = 0; i < ids.length; i += 2000) {
    await localDB.messages.bulkDelete(ids.slice(i, i + 2000));
  }
  if (userId) rewindMessageSync(userId);
  return { count: ids.length, bytes: Math.round(ids.length * avg) };
}

/**
 * Background catch-up sync (useMessageSync) only pulls changes after its
 * watermark. Moving it back a week means the next sync refills the last
 * week of history for every chat; older messages reload when a chat is
 * opened, like they always do.
 */
function rewindMessageSync(userId: string) {
  const key = `sweet_msg_sync_${userId}`;
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const current = readStorage(key);
  if (current && current > weekAgo) writeStorage(key, weekAgo);
}

// --- shelf (per chat) ---

export async function getChatShelf(): Promise<ShelfRow[]> {
  const [visible, media, msgChatIds, avg] = await Promise.all([
    visibleChats(),
    localDB.mediaIndex.toArray(),
    localDB.messages.orderBy('chat_id').keys() as Promise<string[]>,
    avgMessageBytes(),
  ]);

  const rows = new Map<string, ShelfRow>();
  const rowFor = (chatId: string | null): ShelfRow => {
    const chat = chatId ? visible.get(chatId) : undefined;
    const key = chat ? chat.id : PRIVATE_SHELF_KEY;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        name: chat ? chatName(chat) : 'Locked & hidden chats',
        avatar: chat ? (chat.type === 'direct' ? chat.other_user_avatar ?? chat.avatar_url : chat.avatar_url) ?? null : null,
        isPrivate: !chat,
        photoCount: 0, photoBytes: 0, keepsakes: 0, messageCount: 0, messageBytes: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const m of media) {
    const row = rowFor(m.chat_id);
    row.photoCount++;
    row.photoBytes += m.bytes;
    if (m.keepsake === 1) row.keepsakes++;
  }
  for (const id of msgChatIds) rowFor(id).messageCount++;
  for (const row of rows.values()) row.messageBytes = Math.round(row.messageCount * avg);

  return [...rows.values()].sort((a, b) => b.photoBytes + b.messageBytes - (a.photoBytes + a.messageBytes));
}

/** Photos saved for one chat, newest first. Never for the private shelf. */
export async function getChatPhotos(chatId: string): Promise<LocalMediaEntry[]> {
  const rows = await localDB.mediaIndex.where('chat_id').equals(chatId).toArray();
  return rows.sort((a, b) => b.saved_at - a.saved_at);
}

/** Hearted photos from chats that can be shown here, plus how many are hidden. */
export async function getKeepsakes(): Promise<{ visible: LocalMediaEntry[]; hidden: number; names: Map<string, string> }> {
  const [visible, rows] = await Promise.all([visibleChats(), localDB.mediaIndex.where('keepsake').equals(1).toArray()]);
  const shown = rows.filter((r) => r.chat_id && visible.has(r.chat_id)).sort((a, b) => b.saved_at - a.saved_at);
  const names = new Map([...visible].map(([id, c]) => [id, chatName(c)]));
  return { visible: shown, hidden: rows.length - shown.length, names };
}

// --- persistence + maintenance ---

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persist?.()) ?? null;
  } catch {
    return null;
  }
}

let maintenanceRun: Promise<void> | null = null;

/**
 * Index catch-up, Sugar Diet cleanup and today's forecast snapshot. Safe to
 * call often — concurrent calls share one run.
 */
export function runStorageMaintenance(): Promise<void> {
  if (!maintenanceRun) {
    maintenanceRun = (async () => {
      try {
        await syncMediaIndex();
        await enforceMediaPolicy();
        recordSnapshot(await getStorageSummary());
      } catch (err) {
        console.warn('Storage maintenance skipped:', err);
      }
    })().finally(() => {
      maintenanceRun = null;
    });
  }
  return maintenanceRun;
}
