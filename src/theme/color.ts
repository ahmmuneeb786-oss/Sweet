// Small colour toolkit: hex parsing, mixing and WCAG contrast. No deps.

export type RGB = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Accepts "FF1493", "#ff1493" or "#f19". Returns "#RRGGBB" or null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(HEX_RE);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.toUpperCase();
}

export function isHex(input: unknown): input is string {
  return typeof input === 'string' && normalizeHex(input) !== null;
}

export function hexToRgb(hex: string): RGB {
  const h = (normalizeHex(hex) ?? '#000000').slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return ('#' + c(r) + c(g) + c(b)).toUpperCase();
}

/** "R G B" — the form the CSS variables use so Tailwind's /opacity works. */
export function hexToChannels(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/** Blend `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export const WHITE = '#FFFFFF';
export const BLACK = '#000000';

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 – 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.22;
}

export const NEAR_BLACK = '#1F1020';

/**
 * White or a near-black — whichever reads better on `bg`. With
 * `preferWhiteAt`, white wins as long as it reaches that ratio: used for
 * accent surfaces (buttons, own bubbles), where white-on-colour is the look
 * and 3:1 is the WCAG bar for bold/large text.
 */
export function readableOn(bg: string, preferWhiteAt?: number): string {
  if (preferWhiteAt !== undefined && contrast(WHITE, bg) >= preferWhiteAt) return WHITE;
  return contrast(WHITE, bg) >= contrast(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
}

/** Minimum contrast for text on accent surfaces (buttons, own bubbles, badges). */
export const ACCENT_TEXT_MIN = 3;

/**
 * Nudge `fg` toward white AND toward black in small steps and return the
 * smallest change that reaches `ratio` — keeps the hue, so a "fixed" pink
 * is still pink. On mid-tone backgrounds only one direction can work (white
 * never reaches 3:1 on a mid pink), which is why both are tried. If neither
 * gets there, returns whichever end reads best. fg unchanged if already fine.
 */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  return ensureContrastAll(fg, [{ bg, ratio }]);
}

/** ensureContrast against several backgrounds at once (e.g. both ends of a gradient). */
export function ensureContrastAll(fg: string, against: { bg: string; ratio: number }[]): string {
  const worstMargin = (c: string) => Math.min(...against.map((a) => contrast(c, a.bg) / a.ratio));
  if (worstMargin(fg) >= 1) return fg;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const toBlack = mix(fg, BLACK, t);
    const toWhite = mix(fg, WHITE, t);
    const mb = worstMargin(toBlack);
    const mw = worstMargin(toWhite);
    if (mb >= 1 && mw >= 1) return mb >= mw ? toBlack : toWhite;
    if (mb >= 1) return toBlack;
    if (mw >= 1) return toWhite;
  }
  // Rare: one very dark and one very light background — sometimes only a
  // mid grey works for both.
  for (let v = 0; v <= 255; v++) {
    const grey = rgbToHex([v, v, v]);
    if (worstMargin(grey) >= 1) return grey;
  }
  return worstMargin(BLACK) >= worstMargin(WHITE) ? BLACK : WHITE;
}

/** True if `hex` reads well enough on every background given. */
export function passesAll(hex: string, against: { bg: string; ratio: number }[]): boolean {
  return against.every((a) => contrast(hex, a.bg) >= a.ratio);
}

/** Hue-ish fingerprint used to decide whether a background reads as "pink". */
export function isPinkish(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return r > g + 6 && b > g && r >= b;
}
