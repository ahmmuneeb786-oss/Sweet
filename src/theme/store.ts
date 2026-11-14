// The signed-in user's theme library — their own themes, which app theme is
// active, and their "Just me" chat themes — kept in sync with Supabase.
//
// Every change is applied locally first (instant, works offline), saved to
// this device, and queued; the queue is sent in order whenever we're online.
// A server fetch never loses a queued change: queued ops are replayed on top
// of what the server returns. Realtime keeps the user's other devices current.
import { supabase } from '../lib/supabase';
import { readStorage, writeStorage } from '../lib/safeStorage';
import { sanitizeThemeData } from './derive';
import { DEFAULT_PRESET_ID, getAppPreset, getChatPreset } from './presets';
import type { ThemeData } from './tokens';

// ---- Types ----------------------------------------------------------------

export interface UserTheme {
  id: string;
  name: string;
  data: ThemeData;
  based_on: string | null;
  updated_at: string;
}

/** A theme for one chat: a chat preset, or a copy of a custom theme. */
export type ChatTheme =
  | { kind: 'preset'; id: 'love' | 'best_friend' | 'friend' }
  | { kind: 'custom'; id?: string; name: string; data: ThemeData };

export interface ActiveRef {
  kind: 'preset' | 'custom';
  ref: string;
}

export interface ThemeLibrary {
  userId: string | null;
  /** True once the server answered at least once (or we're on cache only). */
  loaded: boolean;
  themes: UserTheme[];
  active: ActiveRef | null;
  /** "Just me" chat themes, by chat id. */
  overrides: Record<string, ChatTheme>;
}

type Op =
  | { op: 'upsertTheme'; theme: UserTheme }
  | { op: 'deleteTheme'; id: string }
  | { op: 'setActive'; active: ActiveRef }
  | { op: 'setOverride'; chatId: string; theme: ChatTheme | null };

export const MAX_THEMES = 20;
export const MAX_NAME = 30;

// ---- Validation of anything read back (server, device cache) --------------

const FALLBACK_SIMPLE = getAppPreset(DEFAULT_PRESET_ID)!.data.simple;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
  return n || 'My theme';
}

function toUserTheme(raw: any): UserTheme | null {
  if (!raw || typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return null;
  return {
    id: raw.id,
    name: cleanName(raw.name),
    data: sanitizeThemeData(raw.data, FALLBACK_SIMPLE),
    based_on: typeof raw.based_on === 'string' ? raw.based_on : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date(0).toISOString(),
  };
}

export function toChatTheme(raw: any): ChatTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'preset' && getChatPreset(raw.id)) return { kind: 'preset', id: raw.id };
  if (raw.kind === 'custom' && raw.data) {
    return {
      kind: 'custom',
      ...(typeof raw.id === 'string' && UUID_RE.test(raw.id) ? { id: raw.id } : {}),
      name: cleanName(raw.name),
      data: sanitizeThemeData(raw.data, FALLBACK_SIMPLE),
    };
  }
  return null;
}

function toActive(raw: any): ActiveRef | null {
  if (!raw || (raw.kind !== 'preset' && raw.kind !== 'custom') || typeof raw.ref !== 'string') return null;
  return { kind: raw.kind, ref: raw.ref };
}

// ---- State + subscription -------------------------------------------------

const EMPTY: ThemeLibrary = { userId: null, loaded: false, themes: [], active: null, overrides: {} };
let state: ThemeLibrary = EMPTY;
const listeners = new Set<() => void>();

function emit(next: ThemeLibrary) {
  state = next;
  listeners.forEach((l) => l());
}

export const themeLibrary = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(): ThemeLibrary {
    return state;
  },
};

// ---- Device storage ---------------------------------------------------------

const libKey = (uid: string) => `sweet_theme_lib_${uid}`;
const queueKey = (uid: string) => `sweet_theme_queue_${uid}`;

function saveLib(lib: ThemeLibrary) {
  if (!lib.userId) return;
  writeStorage(libKey(lib.userId), JSON.stringify({ themes: lib.themes, active: lib.active, overrides: lib.overrides }));
}

function loadLib(uid: string): Pick<ThemeLibrary, 'themes' | 'active' | 'overrides'> {
  try {
    const raw = JSON.parse(readStorage(libKey(uid)) || 'null');
    if (raw && typeof raw === 'object') {
      const overrides: Record<string, ChatTheme> = {};
      for (const [chatId, t] of Object.entries(raw.overrides ?? {})) {
        const ct = toChatTheme(t);
        if (ct) overrides[chatId] = ct;
      }
      return {
        themes: (Array.isArray(raw.themes) ? raw.themes : []).map(toUserTheme).filter(Boolean) as UserTheme[],
        active: toActive(raw.active),
        overrides,
      };
    }
  } catch {
    // corrupt — start empty
  }
  return { themes: [], active: null, overrides: {} };
}

function loadQueue(uid: string): Op[] {
  try {
    const q = JSON.parse(readStorage(queueKey(uid)) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function saveQueue(uid: string, q: Op[]) {
  writeStorage(queueKey(uid), JSON.stringify(q));
}

/** Add an op, dropping earlier ops it makes pointless (last write wins). */
function enqueue(uid: string, op: Op) {
  let q = loadQueue(uid);
  if (op.op === 'setActive') q = q.filter((o) => o.op !== 'setActive');
  if (op.op === 'setOverride') q = q.filter((o) => !(o.op === 'setOverride' && o.chatId === op.chatId));
  if (op.op === 'upsertTheme') q = q.filter((o) => !(o.op === 'upsertTheme' && o.theme.id === op.theme.id));
  if (op.op === 'deleteTheme') q = q.filter((o) => !(o.op === 'upsertTheme' && o.theme.id === op.id));
  q.push(op);
  saveQueue(uid, q);
}

// ---- Applying ops to local state -------------------------------------------

function applyOp(lib: ThemeLibrary, op: Op): ThemeLibrary {
  switch (op.op) {
    case 'upsertTheme': {
      const exists = lib.themes.some((t) => t.id === op.theme.id);
      const themes = exists
        ? lib.themes.map((t) => (t.id === op.theme.id ? op.theme : t))
        : [...lib.themes, op.theme];
      return { ...lib, themes };
    }
    case 'deleteTheme':
      return { ...lib, themes: lib.themes.filter((t) => t.id !== op.id) };
    case 'setActive':
      return { ...lib, active: op.active };
    case 'setOverride': {
      const overrides = { ...lib.overrides };
      if (op.theme) overrides[op.chatId] = op.theme;
      else delete overrides[op.chatId];
      return { ...lib, overrides };
    }
  }
}

function change(op: Op) {
  const uid = state.userId;
  if (!uid) return;
  const next = applyOp(state, op);
  emit(next);
  saveLib(next);
  enqueue(uid, op);
  void flush();
}

// ---- Server ------------------------------------------------------------------

/** A network failure (keep the op, retry later) vs. the server saying no (drop it). */
function isNetworkError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return !err.code || /fetch|network|timeout/i.test(err.message ?? '');
}

async function send(uid: string, op: Op) {
  const now = new Date().toISOString();
  switch (op.op) {
    case 'upsertTheme':
      return supabase.from('user_themes').upsert({
        id: op.theme.id,
        user_id: uid,
        name: op.theme.name,
        data: op.theme.data,
        based_on: op.theme.based_on,
        updated_at: op.theme.updated_at,
      });
    case 'deleteTheme':
      return supabase.from('user_themes').delete().eq('id', op.id).eq('user_id', uid);
    case 'setActive':
      return supabase.from('user_theme_settings').upsert({
        user_id: uid,
        active_kind: op.active.kind,
        active_ref: op.active.ref,
        updated_at: now,
      });
    case 'setOverride':
      return op.theme
        ? supabase.from('chat_theme_overrides').upsert({ user_id: uid, chat_id: op.chatId, theme: op.theme, updated_at: now })
        : supabase.from('chat_theme_overrides').delete().eq('user_id', uid).eq('chat_id', op.chatId);
  }
}

let flushing: Promise<void> | null = null;

export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const uid = state.userId;
    if (!uid) return;
    // Re-read each time: ops may be added while we're sending.
    for (let q = loadQueue(uid); q.length > 0; q = loadQueue(uid)) {
      if (state.userId !== uid) return; // signed out mid-flush
      const op = q[0];
      const { error } = (await send(uid, op)) ?? { error: null };
      if (error && isNetworkError(error)) return; // try again when back online
      if (error) console.warn('[theme] server rejected a theme change, dropping it:', error.message);
      // Remove exactly the op we sent (the queue may have been rewritten).
      saveQueue(uid, loadQueue(uid).filter((o) => JSON.stringify(o) !== JSON.stringify(op)));
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function fetchAll(uid: string, seedActive: () => ActiveRef & { theme?: UserTheme }) {
  const [themesRes, settingsRes, overridesRes] = await Promise.all([
    supabase.from('user_themes').select('id, name, data, based_on, updated_at').eq('user_id', uid).order('created_at'),
    supabase.from('user_theme_settings').select('active_kind, active_ref').eq('user_id', uid).maybeSingle(),
    supabase.from('chat_theme_overrides').select('chat_id, theme').eq('user_id', uid),
  ]);
  if (state.userId !== uid) return;
  if (themesRes.error || settingsRes.error || overridesRes.error) {
    // Offline or tables not there yet — keep the device copy.
    emit({ ...state, loaded: true });
    return;
  }

  const overrides: Record<string, ChatTheme> = {};
  for (const row of overridesRes.data ?? []) {
    const ct = toChatTheme(row.theme);
    if (ct) overrides[row.chat_id] = ct;
  }
  let lib: ThemeLibrary = {
    userId: uid,
    loaded: true,
    themes: (themesRes.data ?? []).map(toUserTheme).filter(Boolean) as UserTheme[],
    active: settingsRes.data ? toActive({ kind: settingsRes.data.active_kind, ref: settingsRes.data.active_ref }) : null,
    overrides,
  };

  // First time on the server: upload what this device was already using.
  if (!lib.active && !loadQueue(uid).some((o) => o.op === 'setActive')) {
    const seed = seedActive();
    if (seed.theme && !lib.themes.some((t) => t.id === seed.theme!.id)) enqueue(uid, { op: 'upsertTheme', theme: seed.theme });
    enqueue(uid, { op: 'setActive', active: { kind: seed.kind, ref: seed.ref } });
  }

  for (const op of loadQueue(uid)) lib = applyOp(lib, op);
  emit(lib);
  saveLib(lib);
  void flush();
}

// ---- Lifecycle -----------------------------------------------------------------

let channel: ReturnType<typeof supabase.channel> | null = null;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;
let onlineHandler: (() => void) | null = null;

/**
 * Start syncing for a signed-in user. `seedActive` reports what this device
 * is showing now, uploaded the first time the account has no saved choice.
 */
export function startThemeSync(uid: string, seedActive: () => ActiveRef & { theme?: UserTheme }) {
  if (state.userId === uid) return;
  stopThemeSync();

  emit({ userId: uid, loaded: false, ...loadLib(uid) });

  const refetch = () => {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => void fetchAll(uid, seedActive), 300);
  };
  void fetchAll(uid, seedActive);

  channel = supabase.channel(`theme-sync-${uid}`);
  for (const table of ['user_themes', 'user_theme_settings', 'chat_theme_overrides']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, refetch);
  }
  channel.subscribe();

  onlineHandler = () => void flush().then(refetch);
  window.addEventListener('online', onlineHandler);
}

export function stopThemeSync() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = null;
  if (onlineHandler) window.removeEventListener('online', onlineHandler);
  onlineHandler = null;
  if (state.userId) emit(EMPTY);
}

// ---- Actions ---------------------------------------------------------------------

export class ThemeLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_THEMES} themes`);
  }
}

export const themeActions = {
  /** Save a new theme; returns it. Throws ThemeLimitError at the cap. */
  createTheme(input: { name: string; data: ThemeData; based_on?: string | null }): UserTheme {
    if (state.themes.length >= MAX_THEMES) throw new ThemeLimitError();
    const theme: UserTheme = {
      id: crypto.randomUUID(),
      name: cleanName(input.name),
      data: sanitizeThemeData(input.data, FALLBACK_SIMPLE),
      based_on: input.based_on ?? null,
      updated_at: new Date().toISOString(),
    };
    change({ op: 'upsertTheme', theme });
    return theme;
  },

  updateTheme(id: string, patch: { name?: string; data?: ThemeData }) {
    const current = state.themes.find((t) => t.id === id);
    if (!current) return;
    change({
      op: 'upsertTheme',
      theme: {
        ...current,
        ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
        ...(patch.data ? { data: sanitizeThemeData(patch.data, FALLBACK_SIMPLE) } : {}),
        updated_at: new Date().toISOString(),
      },
    });
  },

  /** Deletes a theme. If it was the active one, falls back to its preset (or the default). */
  deleteTheme(id: string) {
    const theme = state.themes.find((t) => t.id === id);
    change({ op: 'deleteTheme', id });
    if (state.active?.kind === 'custom' && state.active.ref === id) {
      const fallback = getAppPreset(theme?.based_on) ? theme!.based_on! : DEFAULT_PRESET_ID;
      change({ op: 'setActive', active: { kind: 'preset', ref: fallback } });
    }
  },

  setActive(active: ActiveRef) {
    if (state.active?.kind === active.kind && state.active.ref === active.ref) return;
    change({ op: 'setActive', active });
  },

  /** "Just me" theme for a chat; null removes it. */
  setChatOverride(chatId: string, theme: ChatTheme | null) {
    change({ op: 'setOverride', chatId, theme });
  },

  /**
   * "Both of us": changes the chat's shared theme and posts the
   * theme_change message (the other person's notification) in one go.
   * Online only — it's a message, and the server does both atomically.
   * Also drops my own "Just me" theme for that chat so I see the new one.
   */
  async setSharedChatTheme(chatId: string, theme: ChatTheme | null): Promise<{ error: string | null }> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { error: "You're offline — connect to change the theme for both of you." };
    }
    const payload = theme?.kind === 'custom' ? { kind: 'custom', name: theme.name, data: theme.data } : theme;
    const { error } = await supabase.rpc('set_shared_chat_theme', { p_chat_id: chatId, p_theme: payload });
    if (error) return { error: isNetworkError(error) ? "Couldn't reach the server — try again." : "Couldn't change the theme." };
    if (state.overrides[chatId]) themeActions.setChatOverride(chatId, null);
    return { error: null };
  },
};
