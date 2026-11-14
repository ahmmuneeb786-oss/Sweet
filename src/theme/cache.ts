// This device's copy of the active theme. Read synchronously on startup (and
// by the inline script in index.html, before React loads) so the first frame
// is already in the right colours — no pink flash for Light/Midnight users.
import { readStorage, writeStorage } from '../lib/safeStorage';
import { sanitizeThemeData, legacyFor, resolveTheme } from './derive';
import { DEFAULT_PRESET_ID, LEGACY_PRESET, getAppPreset } from './presets';
import { tokensToVars } from './apply';
import type { LegacyTheme, ThemeData } from './tokens';

/** Keep in sync with the inline script in index.html. */
export const THEME_CACHE_KEY = 'sweet_theme_v1';
/** The pre-token setting ('light' | 'dark' | 'sweet'), migrated on first read. */
const OLD_THEME_KEY = 'theme';

export type ActiveTheme =
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; id: string; name: string; data: ThemeData };

interface CacheShape {
  active: ActiveTheme;
  /** Resolved CSS variables — all the inline script needs. */
  vars: Record<string, string>;
  legacy: LegacyTheme;
}

const FALLBACK = getAppPreset(DEFAULT_PRESET_ID)!.data.simple;

export function themeDataFor(active: ActiveTheme): ThemeData {
  if (active.kind === 'custom') return active.data;
  return (getAppPreset(active.id) ?? getAppPreset(DEFAULT_PRESET_ID)!).data;
}

function sanitizeActive(raw: unknown): ActiveTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === 'preset' && typeof a.id === 'string' && getAppPreset(a.id)) {
    return { kind: 'preset', id: a.id };
  }
  if (a.kind === 'custom' && typeof a.id === 'string') {
    return {
      kind: 'custom',
      id: a.id,
      name: typeof a.name === 'string' ? a.name.slice(0, 30) : 'My theme',
      data: sanitizeThemeData(a.data, FALLBACK),
    };
  }
  return null;
}

export function readCachedTheme(): ActiveTheme {
  try {
    const raw = readStorage(THEME_CACHE_KEY);
    if (raw) {
      const active = sanitizeActive(JSON.parse(raw)?.active);
      if (active) return active;
    }
  } catch {
    // corrupt cache — fall through
  }
  const old = readStorage(OLD_THEME_KEY);
  if (old === 'light' || old === 'dark' || old === 'sweet') {
    return { kind: 'preset', id: LEGACY_PRESET[old] };
  }
  return { kind: 'preset', id: DEFAULT_PRESET_ID };
}

export function writeCachedTheme(active: ActiveTheme) {
  const tokens = resolveTheme(themeDataFor(active));
  const shape: CacheShape = { active, vars: tokensToVars(tokens), legacy: legacyFor(tokens) };
  writeStorage(THEME_CACHE_KEY, JSON.stringify(shape));
  // Keep the old key meaningful for anything that still reads it.
  writeStorage(OLD_THEME_KEY, shape.legacy);
}
