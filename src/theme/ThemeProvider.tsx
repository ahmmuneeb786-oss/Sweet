import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode,
} from 'react';
import { applyPageChrome, applyTokens } from './apply';
import { readCachedTheme, themeDataFor, writeCachedTheme, type ActiveTheme } from './cache';
import { legacyFor, resolveTheme } from './derive';
import { DEFAULT_PRESET_ID, LEGACY_PRESET, getAppPreset } from './presets';
import { startThemeSync, stopThemeSync, themeActions, themeLibrary, type ThemeLibrary } from './store';
import { clearSharedThemeCache } from './sharedChatTheme';
import type { LegacyTheme, ThemeData, Tokens } from './tokens';

interface ThemeContextValue {
  /** What's on screen: the user's pick, or a forced preset (sign-in). */
  active: ActiveTheme;
  /** What the user actually picked, ignoring any forced preset. */
  chosen: ActiveTheme;
  /** The 4 colours + pins behind it. */
  data: ThemeData;
  /** All 28 colours, resolved. */
  tokens: Tokens;
  /** Closest old theme name, for components not on tokens yet. */
  legacy: LegacyTheme;
  /** The signed-in user's saved themes and chat themes (empty when signed out). */
  library: ThemeLibrary;
  /** Switch the app theme (saved to the account when signed in). */
  setActive: (next: ActiveTheme) => void;
  /** Old three-way switch, kept so existing callers keep working. */
  setLegacyTheme: (t: LegacyTheme) => void;
  /** Show a preset without saving it (see ForcePresetTheme). null = back to the user's theme. */
  setForcedPreset: (id: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function sameActive(a: ActiveTheme, b: ActiveTheme): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'custom' && b.kind === 'custom') {
    return a.name === b.name && JSON.stringify(a.data) === JSON.stringify(b.data);
  }
  return true;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Synchronous read: the very first render already has the right theme.
  const [active, setActiveState] = useState<ActiveTheme>(readCachedTheme);
  const library = useSyncExternalStore(themeLibrary.subscribe, themeLibrary.get);
  // A screen that always looks the same whatever the user picked (sign-in).
  const [forcedPreset, setForcedPreset] = useState<string | null>(null);
  const shown = useMemo<ActiveTheme>(
    () => (forcedPreset ? { kind: 'preset', id: forcedPreset } : active),
    [forcedPreset, active],
  );

  const data = useMemo(() => themeDataFor(shown), [shown]);
  const tokens = useMemo(() => resolveTheme(data), [data]);
  const legacy = useMemo(() => legacyFor(tokens), [tokens]);

  // Layout effect, not effect: the variables land before the browser paints.
  useLayoutEffect(() => {
    applyTokens(document.documentElement, tokens);
    applyPageChrome(tokens);
    // The user's own choice, never a forced preset.
    writeCachedTheme(active);
  }, [active, tokens]);

  // Follow the account: a choice made on another device, an edit to the
  // active custom theme, or that theme being deleted.
  useEffect(() => {
    if (!library.userId || !library.active) return;
    const { kind, ref } = library.active;
    let next: ActiveTheme | null = null;
    if (kind === 'preset') {
      next = { kind: 'preset', id: getAppPreset(ref) ? ref : DEFAULT_PRESET_ID };
    } else {
      const theme = library.themes.find((t) => t.id === ref);
      if (theme) next = { kind: 'custom', id: theme.id, name: theme.name, data: theme.data };
      else if (library.loaded) next = { kind: 'preset', id: DEFAULT_PRESET_ID };
    }
    if (next) setActiveState((cur) => (sameActive(cur, next!) ? cur : next!));
  }, [library]);

  const setActive = useCallback((next: ActiveTheme) => {
    setActiveState(next);
    if (themeLibrary.get().userId) themeActions.setActive({ kind: next.kind, ref: next.id });
  }, []);

  const setLegacyTheme = useCallback(
    (t: LegacyTheme) => setActive({ kind: 'preset', id: LEGACY_PRESET[t] }),
    [setActive],
  );

  const value = useMemo(
    () => ({ active: shown, chosen: active, data, tokens, legacy, library, setActive, setLegacyTheme, setForcedPreset }),
    [shown, active, data, tokens, legacy, library, setActive, setLegacyTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/**
 * While mounted, the app shows this preset instead of the user's theme
 * (nothing is saved). Used by the sign-in screen, which is always Sweet.
 * Layout effect: the switch lands before the first paint, so no flash.
 */
export function ForcePresetTheme({ id }: { id: string }) {
  const { setForcedPreset } = useTheme();
  useLayoutEffect(() => {
    setForcedPreset(id);
    return () => setForcedPreset(null);
  }, [id, setForcedPreset]);
  return null;
}

/**
 * Starts account sync when someone signs in; on sign-out stops it and puts
 * the device back on the default theme, so the next person to sign in here
 * doesn't get the previous account's colours. Render once, inside the
 * ThemeProvider, with the signed-in user's id (or null).
 */
export function ThemeAccountSync({ userId }: { userId: string | null }) {
  // The real choice: while the sign-in screen forces Sweet, 'active' is Sweet.
  const { chosen: active, setActive } = useTheme();
  const activeRef = useRef(active);
  activeRef.current = active;
  const prevUser = useRef<string | null>(null);

  useEffect(() => {
    if (userId) {
      startThemeSync(userId, () => {
        const a = activeRef.current;
        if (a.kind === 'custom') {
          return {
            kind: 'custom',
            ref: a.id,
            theme: { id: a.id, name: a.name, data: a.data, based_on: null, updated_at: new Date().toISOString() },
          };
        }
        return { kind: 'preset', ref: a.id };
      });
    } else if (prevUser.current) {
      stopThemeSync();
      clearSharedThemeCache();
      setActive({ kind: 'preset', id: DEFAULT_PRESET_ID });
    }
    prevUser.current = userId;
  }, [userId, setActive]);

  return null;
}
