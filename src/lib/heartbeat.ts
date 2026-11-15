/*
  Heartbeat Tap: vibration patterns the user taps out themselves.
  A pattern is [buzz, pause, buzz, pause, …] in ms — the format
  navigator.vibrate() and the push notification's `vibrate` both take.
  Limits match the database check and the service worker: 1–24 numbers,
  each 0–1000 ms, at most 6 s in total.
*/

export const MAX_STEPS = 24;
export const MAX_STEP_MS = 1000;
export const MAX_TOTAL_MS = 6000;
/** Taps shorter than this still buzz noticeably. */
const MIN_BUZZ_MS = 40;

export const HEARTBEAT_PRESETS: { id: string; emoji: string; name: string; pattern: number[] }[] = [
  { id: 'soft', emoji: '🍬', name: 'Soft buzz', pattern: [100, 50, 100] },
  { id: 'heart', emoji: '💓', name: 'Heartbeat', pattern: [80, 90, 140, 600, 80, 90, 140] },
  { id: 'double', emoji: '✌️', name: 'Double tap', pattern: [60, 80, 60] },
  { id: 'hug', emoji: '🤗', name: 'Long hug', pattern: [700] },
  { id: 'giggle', emoji: '😆', name: 'Giggle', pattern: [40, 40, 40, 40, 40, 40, 40, 40, 40] },
];

export function isValidPattern(p: unknown): p is number[] {
  return Array.isArray(p) && p.length >= 1 && p.length <= MAX_STEPS &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_STEP_MS) &&
    p.reduce((a: number, b: number) => a + b, 0) <= MAX_TOTAL_MS;
}

/**
 * Turns recorded presses into a pattern. `presses` are [downAt, upAt] times
 * (ms, any clock). Gaps between presses become pauses. Everything is clamped
 * so the result is always valid.
 */
export function patternFromPresses(presses: [number, number][]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < presses.length; i++) {
    const [down, up] = presses[i];
    if (i > 0) {
      const pause = Math.round(Math.min(MAX_STEP_MS, Math.max(0, down - presses[i - 1][1])));
      if (out.length + 2 > MAX_STEPS || total + pause + MIN_BUZZ_MS > MAX_TOTAL_MS) break;
      out.push(pause);
      total += pause;
    }
    const buzz = Math.round(Math.min(MAX_STEP_MS, Math.max(MIN_BUZZ_MS, up - down)));
    if (out.length + 1 > MAX_STEPS || total + buzz > MAX_TOTAL_MS) {
      if (out.length % 2 === 0 && out.length > 0) out.pop(); // never end on a pause
      break;
    }
    out.push(buzz);
    total += buzz;
  }
  return out;
}

export function patternLength(p: number[]): number {
  return p.reduce((a, b) => a + b, 0);
}

/** Which preset this is, if any (for friendly names). */
export function presetFor(p: number[] | null | undefined) {
  if (!p) return null;
  const key = p.join(',');
  return HEARTBEAT_PRESETS.find((x) => x.pattern.join(',') === key) ?? null;
}

export function describePattern(p: number[] | null | undefined): string {
  if (!p) return 'Soft buzz (default)';
  const preset = presetFor(p);
  if (preset) return `${preset.emoji} ${preset.name}`;
  const beats = Math.ceil(p.length / 2);
  return `💗 Your own · ${beats} beat${beats === 1 ? '' : 's'}`;
}

/**
 * Whether THIS device can actually be felt. Desktop Chrome has
 * navigator.vibrate but no motor; iPhone has neither. Patterns are saved to
 * the account, so you can still make them here for your phone.
 */
export function canFeelHere(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator && /Android/i.test(navigator.userAgent);
}

export function buzz(p: number[] | number) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(p);
  } catch {
    // some browsers throw when called without a user gesture — harmless
  }
}
