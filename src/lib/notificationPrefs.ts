import { supabase } from './supabase';
import { readStorage, writeStorage } from './safeStorage';

/*
  The user's notification preferences (table notification_prefs, one row per
  account, read by the push edge function). Cached locally so the Settings
  tab paints instantly and still shows the right values offline.
*/

export type Peek = 'full' | 'sender' | 'secret';

export interface NotificationPrefs {
  messages: boolean;
  friend_requests: boolean;
  theme_changes: boolean;
  calls: boolean;
  peek: Peek;
  timezone: string;
  vibration: number[] | null;
  vibration_by_sender: Record<string, number[]>;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  messages: true,
  friend_requests: true,
  theme_changes: true,
  calls: true,
  peek: 'full',
  timezone: 'UTC',
  vibration: null,
  vibration_by_sender: {},
};

const cacheKey = (userId: string) => `sweet_notif_prefs_v1:${userId}`;
const TZ_KEY = (userId: string) => `sweet_notif_tz_v1:${userId}`;

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function pick(row: Record<string, unknown> | null | undefined): NotificationPrefs {
  const out = { ...DEFAULT_PREFS };
  if (!row) return out;
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof NotificationPrefs)[]) {
    if (row[k] !== undefined && row[k] !== null) (out as Record<string, unknown>)[k] = row[k];
  }
  if (row.vibration === null) out.vibration = null;
  return out;
}

export function cachedPrefs(userId: string): NotificationPrefs {
  try {
    const raw = readStorage(cacheKey(userId));
    return raw ? pick(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function cache(userId: string, prefs: NotificationPrefs) {
  writeStorage(cacheKey(userId), JSON.stringify(prefs));
}

/** Server copy (falls back to the cache when offline or not saved yet). */
export async function loadPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('messages, friend_requests, theme_changes, calls, peek, timezone, vibration, vibration_by_sender')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const prefs = data ? pick(data) : cachedPrefs(userId);
  cache(userId, prefs);
  return prefs;
}

/** Saves only the fields given. Throws on failure (the caller reverts). */
export async function savePrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<void> {
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
  cache(userId, { ...cachedPrefs(userId), ...patch });
}

/**
 * Keeps the server's timezone equal to this device's, so Bedtime Jars open
 * and close at the right local time (also after travelling). Cheap: only
 * writes when the timezone actually changed since the last successful sync.
 */
export async function syncTimezone(userId: string): Promise<void> {
  const tz = deviceTimezone();
  if (readStorage(TZ_KEY(userId)) === tz) return;
  try {
    await savePrefs(userId, { timezone: tz });
    writeStorage(TZ_KEY(userId), tz);
  } catch {
    // offline / unknown zone — try again next start
  }
}
