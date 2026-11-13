/**
 * Sugar Forecast — where storage is heading, not just where it is.
 *
 * Photo growth comes straight from the media index (every saved photo
 * carries its size and save time), so a forecast is available from day one.
 * A tiny daily snapshot of the totals is also kept (30 days, localStorage)
 * for the trend line.
 *
 * Suggestions only quote numbers we actually measured — e.g. auto-downloaded
 * photos that were never opened — never guessed savings.
 */
import { localDB, type LocalChat } from '../../db';
import { readStorage, writeStorage } from '../safeStorage';
import { getStoragePrefs, type AutoDownload } from './prefs';
import type { StorageSummary } from './manager';

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;
const HISTORY_KEY = 'sweet_storage_history';
const HISTORY_DAYS = 30;

export interface Snapshot {
  d: string; // YYYY-MM-DD
  photos: number;
  messages: number;
  total: number;
}

export type SuggestionAction =
  | { kind: 'autoDownload'; value: AutoDownload }
  | { kind: 'keepDays'; value: number }
  | { kind: 'cleanNeverOpened' }
  | { kind: 'openChat'; chatId: string };

export interface Suggestion {
  id: string;
  emoji: string;
  text: string;
  actionLabel: string;
  action: SuggestionAction;
}

export interface Forecast {
  /** Days of photo history the rate is based on (0 = nothing yet). */
  daysOfData: number;
  photoBytesPerDay: number;
  photoBytes: number;
  capBytes: number;
  /** null = not growing (or no data). 0 = already at the limit. */
  daysUntilCap: number | null;
  neverOpened: { count: number; bytes: number };
  history: Snapshot[];
  suggestions: Suggestion[];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function readHistory(): Snapshot[] {
  try {
    const parsed = JSON.parse(readStorage(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.d === 'string') : [];
  } catch {
    return [];
  }
}

/** Save (or replace) today's totals. Called by storage maintenance. */
export function recordSnapshot(s: StorageSummary) {
  const d = today();
  const history = readHistory().filter((h) => h.d !== d);
  history.push({ d, photos: s.photos.bytes, messages: s.messages.bytes, total: s.usage ?? s.photos.bytes + s.messages.bytes });
  writeStorage(HISTORY_KEY, JSON.stringify(history.sort((a, b) => a.d.localeCompare(b.d)).slice(-HISTORY_DAYS)));
}

function chatName(c: LocalChat) {
  return c.type === 'direct' ? c.other_user_name || c.name || 'a chat' : c.name || 'a group';
}

export async function getForecast(): Promise<Forecast> {
  const prefs = getStoragePrefs();
  const capBytes = prefs.maxPhotoMB * 1024 * 1024;
  const now = Date.now();
  const [rows, chats] = await Promise.all([localDB.mediaIndex.toArray(), localDB.chats.toArray()]);

  const photoBytes = rows.reduce((s, r) => s + r.bytes, 0);
  // saved_at 0 = indexed from an older cache, date unknown — not growth.
  const dated = rows.filter((r) => r.saved_at > 0);
  const oldest = dated.reduce((min, r) => Math.min(min, r.saved_at), now);
  const daysOfData = Math.min(WINDOW_DAYS, (now - oldest) / DAY);
  const windowStart = now - WINDOW_DAYS * DAY;
  const recent = dated.filter((r) => r.saved_at >= windowStart);
  const recentBytes = recent.reduce((s, r) => s + r.bytes, 0);
  const photoBytesPerDay = daysOfData >= 1 ? recentBytes / daysOfData : 0;

  let daysUntilCap: number | null = null;
  if (photoBytes >= capBytes * 0.98) daysUntilCap = 0;
  else if (photoBytesPerDay > 0) daysUntilCap = Math.round((capBytes - photoBytes) / photoBytesPerDay);

  const neverOpenedRows = rows.filter((r) => r.source === 'auto' && r.last_viewed === r.saved_at && r.keepsake !== 1);
  const neverOpened = { count: neverOpenedRows.length, bytes: neverOpenedRows.reduce((s, r) => s + r.bytes, 0) };

  // --- suggestions, strongest first ---
  const suggestions: Suggestion[] = [];
  const MB = 1024 * 1024;

  if (neverOpened.bytes >= 5 * MB) {
    suggestions.push({
      id: 'never-opened',
      emoji: '🙈',
      text: `${neverOpened.count} auto-downloaded photos (${formatBytes(neverOpened.bytes)}) were never opened.`,
      actionLabel: 'Unwrap them',
      action: { kind: 'cleanNeverOpened' },
    });
  }

  const recentAuto = recent.filter((r) => r.source === 'auto').reduce((s, r) => s + r.bytes, 0);
  if (prefs.autoDownload === 'always' && recentBytes > 0 && recentAuto / recentBytes >= 0.5 && photoBytesPerDay >= 1 * MB) {
    suggestions.push({
      id: 'wifi-only',
      emoji: '📶',
      text: `${Math.round((recentAuto / recentBytes) * 100)}% of new photos were auto-downloaded. Wi-Fi only skips that on mobile data.`,
      actionLabel: 'Use Wi-Fi only',
      action: { kind: 'autoDownload', value: 'wifi' },
    });
  }

  if (prefs.keepDays === 0 && daysUntilCap !== null && daysUntilCap < 30) {
    suggestions.push({
      id: 'expire',
      emoji: '⏳',
      text: 'Your jar fills within a month. Expire photos you haven\'t looked at in 30 days?',
      actionLabel: 'Keep 30 days',
      action: { kind: 'keepDays', value: 30 },
    });
  }

  // Which chat feeds the jar most — only named if it's a visible chat.
  const visible = new Map(chats.filter((c) => !c.is_locked).map((c) => [c.id, c]));
  const byChat = new Map<string, number>();
  for (const r of recent) if (r.chat_id) byChat.set(r.chat_id, (byChat.get(r.chat_id) ?? 0) + r.bytes);
  const [topId, topBytes] = [...byChat].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topId && topBytes && recentBytes > 0 && topBytes / recentBytes >= 0.4 && visible.has(topId) && recentBytes >= 5 * MB) {
    suggestions.push({
      id: 'top-chat',
      emoji: '🍭',
      text: `${chatName(visible.get(topId)!)} brought ${Math.round((topBytes / recentBytes) * 100)}% of new photos in the last two weeks.`,
      actionLabel: 'Open shelf',
      action: { kind: 'openChat', chatId: topId },
    });
  }

  return { daysOfData, photoBytesPerDay, photoBytes, capBytes, daysUntilCap, neverOpened, history: readHistory(), suggestions };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
