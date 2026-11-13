/**
 * Sugar Diet — the user's media storage settings. Device-only conveniences,
 * so they live in localStorage (via safeStorage) and fall back to defaults
 * when storage is blocked.
 */
import { readStorage, writeStorage } from '../safeStorage';

export type AutoDownload = 'always' | 'wifi' | 'never';

export interface StoragePrefs {
  /** When received photos are downloaded in the background. */
  autoDownload: AutoDownload;
  /** Photos not viewed for this many days are removed. 0 = keep forever. */
  keepDays: number;
  /** Photo storage limit in MB. The least recently viewed go first. */
  maxPhotoMB: number;
}

export const KEEP_DAY_OPTIONS = [7, 30, 90, 0] as const;
export const MAX_PHOTO_MB_OPTIONS = [250, 500, 1024, 2048] as const;

const KEY = 'sweet_storage_prefs';
const EVENT = 'sweet-storage-prefs';

const DEFAULTS: StoragePrefs = { autoDownload: 'always', keepDays: 0, maxPhotoMB: 500 };

export function getStoragePrefs(): StoragePrefs {
  try {
    const raw = readStorage(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      autoDownload: ['always', 'wifi', 'never'].includes(parsed.autoDownload) ? parsed.autoDownload : DEFAULTS.autoDownload,
      keepDays: (KEEP_DAY_OPTIONS as readonly number[]).includes(parsed.keepDays) ? parsed.keepDays : DEFAULTS.keepDays,
      maxPhotoMB: (MAX_PHOTO_MB_OPTIONS as readonly number[]).includes(parsed.maxPhotoMB) ? parsed.maxPhotoMB : DEFAULTS.maxPhotoMB,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setStoragePrefs(patch: Partial<StoragePrefs>): StoragePrefs {
  const next = { ...getStoragePrefs(), ...patch };
  writeStorage(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function onStoragePrefsChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/**
 * True when the connection is known to cost the user data (cellular), or
 * they've turned on Data Saver. Most desktop browsers don't report the
 * connection type at all — those are treated as unmetered.
 */
export function isMeteredConnection(): boolean {
  const c = (navigator as any).connection;
  if (!c) return false;
  return c.saveData === true || c.type === 'cellular';
}
