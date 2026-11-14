// A chat's "Both of us" theme (chats.shared_theme): cached on this device so
// a chat opens in its colours instantly (and offline), refreshed from the
// server, and kept live over realtime — when the other person changes it,
// this chat recolours without a reload.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { readStorage, writeStorage } from '../lib/safeStorage';
import { toChatTheme, type ChatTheme } from './store';

export interface SharedChatTheme {
  theme: ChatTheme | null;
  /** Who set it (user id), when known. */
  by: string | null;
}

const CACHE_KEY = 'sweet_shared_chat_themes';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONE: SharedChatTheme = { theme: null, by: null };

// Parsed once, then kept in memory: the chat list asks for every row on
// every render, and re-parsing localStorage each time was wasted work.
let memo: Record<string, SharedChatTheme> | null = null;

function readCache(): Record<string, SharedChatTheme> {
  if (memo) return memo;
  try {
    const raw = JSON.parse(readStorage(CACHE_KEY) || '{}');
    memo = raw && typeof raw === 'object' ? raw : {};
  } catch {
    memo = {};
  }
  return memo!;
}

function writeCache(all: Record<string, SharedChatTheme>) {
  memo = all;
  writeStorage(CACHE_KEY, JSON.stringify(all));
  version++;
  versionListeners.forEach((l) => l());
}

// Bumped on every change, so the chat list can redraw its stripes.
let version = 0;
const versionListeners = new Set<() => void>();
function subscribeVersion(l: () => void) {
  versionListeners.add(l);
  return () => versionListeners.delete(l);
}
/** Changes whenever any cached shared theme changes. */
export function useSharedThemesVersion(): number {
  return useSyncExternalStore(subscribeVersion, () => version);
}

/** This device's last-known shared theme for a chat (no network). */
export function cachedSharedTheme(chatId: string): SharedChatTheme {
  const entry = readCache()[chatId];
  if (!entry) return NONE;
  return { theme: toChatTheme(entry.theme), by: typeof entry.by === 'string' ? entry.by : null };
}

const listeners = new Set<(chatId: string, value: SharedChatTheme) => void>();

/** Store (and broadcast) a chat's shared theme — from the server, realtime, or our own change. */
export function rememberSharedTheme(chatId: string, rawTheme: unknown, by: string | null) {
  const value: SharedChatTheme = { theme: toChatTheme(rawTheme), by };
  const all = { ...readCache() };
  const before = JSON.stringify(all[chatId] ?? null);
  if (value.theme) all[chatId] = value;
  else delete all[chatId];
  // Nothing changed (e.g. the chat list refreshing): skip the write and the redraws.
  if (JSON.stringify(all[chatId] ?? null) === before) return;
  writeCache(all);
  listeners.forEach((l) => l(chatId, value));
}

/** Forget every cached shared theme (sign-out). */
export function clearSharedThemeCache() {
  writeCache({});
}

/**
 * Fill the cache for many chats in one request, so the chat list can show
 * the stripe of a chat the other person themed before it's opened here.
 * Errors (offline, migration not run) are ignored.
 */
export async function prefetchSharedThemes(chatIds: string[]) {
  // Only real chat rows: Saved Messages ('self-<uid>') isn't a uuid, and one
  // non-uuid id makes Postgres reject the whole request.
  const ids = chatIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('chats')
    .select('id, shared_theme, shared_theme_by')
    .in('id', ids);
  if (error || !data) return;
  for (const row of data as { id: string; shared_theme: unknown; shared_theme_by: string | null }[]) {
    rememberSharedTheme(row.id, row.shared_theme, row.shared_theme_by ?? null);
  }
}

export function useSharedChatTheme(chatId: string | undefined): SharedChatTheme {
  const [value, setValue] = useState<SharedChatTheme>(() => (chatId ? cachedSharedTheme(chatId) : NONE));

  useEffect(() => {
    if (!chatId) {
      setValue(NONE);
      return;
    }
    let cancelled = false;
    setValue(cachedSharedTheme(chatId));

    const onChange = (id: string, v: SharedChatTheme) => {
      if (id === chatId && !cancelled) setValue(v);
    };
    listeners.add(onChange);

    // Fresh from the server. An error (offline, or the theme migration not
    // run yet) just keeps the cached value.
    supabase
      .from('chats')
      .select('shared_theme, shared_theme_by')
      .eq('id', chatId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        rememberSharedTheme(chatId, data.shared_theme, data.shared_theme_by ?? null);
      });

    // Live: the other person changing it recolours this chat right away.
    const channel = supabase
      .channel(`chat-theme-${chatId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chats', filter: `id=eq.${chatId}` }, (payload) => {
        const row = payload.new as { shared_theme?: unknown; shared_theme_by?: string | null };
        if (!('shared_theme' in row)) return;
        rememberSharedTheme(chatId, row.shared_theme, row.shared_theme_by ?? null);
      })
      .subscribe();

    return () => {
      cancelled = true;
      listeners.delete(onChange);
      void supabase.removeChannel(channel);
    };
  }, [chatId]);

  return value;
}
