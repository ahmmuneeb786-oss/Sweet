// 4 colours in, 28 tokens out. Tokens are worked out in dependency order and
// every step reads the user's pin first, so pinning e.g. "my bubble" re-picks
// a readable "my bubble text" automatically. Only colours the user pins by
// hand can end up hard to read, and contrast.ts flags those.
import { TOKEN_KEYS, type SimpleColors, type ThemeData, type Tokens, type TokenKey, type LegacyTheme } from './tokens';
import { ACCENT_TEXT_MIN, NEAR_BLACK, contrast, ensureContrast, ensureContrastAll, isDarkColor, isHex, isPinkish, mix, normalizeHex, WHITE } from './color';

/**
 * Text for an accent surface that may be a gradient (your bubbles, the chat
 * header): white if it reaches `min` on every stop, else whichever of white
 * or near-black reads best.
 */
export function accentTextFor(backgrounds: string[], min = ACCENT_TEXT_MIN): string {
  const worst = (c: string) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(WHITE) >= min) return WHITE;
  return worst(WHITE) >= worst(NEAR_BLACK) ? WHITE : NEAR_BLACK;
}

export function deriveTokens(simple: SimpleColors, pins: Partial<Tokens> = {}): Tokens {
  const { accent } = simple;
  const t = {} as Tokens;
  const set = (k: TokenKey, derived: () => string) => {
    t[k] = pins[k] ?? derived();
  };

  set('bg', () => simple.bg);
  set('card', () => simple.card);
  set('ink', () => simple.ink);
  const dark = isDarkColor(t.bg);

  set('panel', () => mix(t.bg, accent, dark ? 0.05 : 0.08));
  // Hover rows sit on cards AND on panels, so it must differ from both: a tint
  // of the panel (always darker than white cards) in light themes, a clear lift
  // over the card in dark ones.
  set('cardHover', () => (dark ? mix(t.card, t.ink, 0.1) : mix(t.panel, accent, 0.08)));
  set('input', () => (dark ? mix(t.card, t.ink, 0.05) : mix(t.card, t.bg, 0.5)));
  set('border', () => mix(t.card, mix(t.ink, accent, 0.5), dark ? 0.16 : 0.18));

  // Before the text colours: soft/faint text and links are drawn on all of these.
  set('secondary', () => mix(t.card, accent, dark ? 0.16 : 0.12));
  set('wallpaper', () => mix(t.bg, accent, dark ? 0.03 : 0.04));

  // Readable on EVERY surface the UI puts them on, not just cards.
  const onSurfaces = (ratio: number) =>
    [t.card, t.panel, t.bg, t.secondary, t.wallpaper, t.input].map((bg) => ({ bg, ratio }));
  set('inkSoft', () => ensureContrastAll(mix(t.ink, t.card, 0.3), onSurfaces(4.5)));
  set('inkFaint', () => ensureContrastAll(mix(t.ink, t.card, 0.5), onSurfaces(3)));
  set('link', () => ensureContrastAll(accent, onSurfaces(4.5)));

  set('primary', () => accent);
  // Badges and the 'on' toggle carry main-button text too (unread counts, the knob).
  set('badge', () => accent);
  set('toggleOn', () => accent);
  set('onPrimary', () => accentTextFor([t.primary, t.badge, t.toggleOn]));
  set('onSecondary', () => ensureContrast(t.ink, t.secondary, 4.5));
  set('danger', () => (dark ? '#F87171' : '#DC2626'));

  set('bubbleMine', () => accent);
  set('bubbleMineTo', () => (dark ? mix(t.bubbleMine, t.bg, 0.35) : mix(t.bubbleMine, WHITE, 0.35)));
  // Text has to read on BOTH ends of the gradient.
  set('onBubbleMine', () => accentTextFor([t.bubbleMine, t.bubbleMineTo]));
  set('bubbleTheirs', () => (dark ? mix(t.card, t.ink, 0.07) : t.card));
  set('onBubbleTheirs', () => ensureContrast(t.ink, t.bubbleTheirs, 4.5));
  set('chatHeader', () => accent);
  set('chatHeaderTo', () => t.bubbleMineTo);
  set('onChatHeader', () => accentTextFor([t.chatHeader, t.chatHeaderTo]));

  set('toggleOff', () => mix(t.card, t.ink, dark ? 0.25 : 0.2));
  set('online', () => '#22C55E');

  return t;
}

/** Full tokens for a stored theme. */
export function resolveTheme(data: ThemeData): Tokens {
  return deriveTokens(data.simple, data.overrides ?? {});
}

/**
 * Bring untrusted data (localStorage, database, a pasted code) into a valid
 * ThemeData. Bad colours fall back to `fallback`; unknown keys are dropped.
 */
export function sanitizeThemeData(raw: unknown, fallback: SimpleColors): ThemeData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const simpleIn = (obj.simple && typeof obj.simple === 'object' ? obj.simple : {}) as Record<string, unknown>;
  const simple: SimpleColors = {
    bg: normalizeHex(simpleIn.bg as string) ?? fallback.bg,
    card: normalizeHex(simpleIn.card as string) ?? fallback.card,
    ink: normalizeHex(simpleIn.ink as string) ?? fallback.ink,
    accent: normalizeHex(simpleIn.accent as string) ?? fallback.accent,
  };
  const overrides: Partial<Tokens> = {};
  const oIn = (obj.overrides && typeof obj.overrides === 'object' ? obj.overrides : {}) as Record<string, unknown>;
  for (const k of TOKEN_KEYS) {
    if (isHex(oIn[k])) overrides[k] = normalizeHex(oIn[k] as string)!;
  }
  return { simple, overrides };
}

/**
 * The closest old 'light' | 'dark' | 'sweet' for a theme, for components not
 * yet moved onto tokens: dark background -> dark, pink-tinted -> sweet.
 */
export function legacyFor(tokens: Tokens): LegacyTheme {
  if (isDarkColor(tokens.bg)) return 'dark';
  if (isPinkish(tokens.bg) || isPinkish(tokens.panel)) return 'sweet';
  return 'light';
}
