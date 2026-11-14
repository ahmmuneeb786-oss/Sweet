// Readability guard: which text/background pairs to check, and the
// one-tap fix. It warns and offers a fix — it never blocks a theme.
import type { TokenKey, Tokens } from './tokens';
import { ACCENT_TEXT_MIN, contrast, ensureContrastAll, passesAll } from './color';

export interface ContrastPair {
  fg: TokenKey;
  bg: TokenKey;
  /** WCAG: 4.5 for body text; 3 for secondary text and text on accent surfaces (bold, white-on-colour). */
  min: number;
  label: string;
}

const SURFACE_NAMES = {
  card: 'cards', panel: 'panels', bg: 'background', secondary: 'soft buttons', wallpaper: 'chat wallpaper', input: 'inputs',
} as const;

export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'ink', bg: 'bg', min: 4.5, label: 'Text on background' },
  { fg: 'ink', bg: 'card', min: 4.5, label: 'Text on cards' },
  { fg: 'ink', bg: 'panel', min: 4.5, label: 'Text on panels' },
  // Every surface the UI actually puts secondary text, faint text and links on.
  ...(['card', 'panel', 'bg', 'secondary', 'wallpaper', 'input'] as const).flatMap((bg) => {
    const where = SURFACE_NAMES[bg];
    return [
      { fg: 'inkSoft' as const, bg, min: 3, label: `Secondary text on ${where}` },
      { fg: 'inkFaint' as const, bg, min: 3, label: `Faint text on ${where}` },
      { fg: 'link' as const, bg, min: 3, label: `Links on ${where}` },
    ];
  }),
  { fg: 'onPrimary', bg: 'primary', min: ACCENT_TEXT_MIN, label: 'Main button text' },
  { fg: 'onPrimary', bg: 'badge', min: ACCENT_TEXT_MIN, label: 'Text on badges' },
  { fg: 'onPrimary', bg: 'toggleOn', min: ACCENT_TEXT_MIN, label: 'Toggle knob' },
  { fg: 'onSecondary', bg: 'secondary', min: 4.5, label: 'Soft button text' },
  { fg: 'onBubbleMine', bg: 'bubbleMine', min: ACCENT_TEXT_MIN, label: 'Text in your bubbles' },
  { fg: 'onBubbleMine', bg: 'bubbleMineTo', min: ACCENT_TEXT_MIN, label: 'Text in your bubbles (gradient end)' },
  { fg: 'onBubbleTheirs', bg: 'bubbleTheirs', min: 4.5, label: 'Text in their bubbles' },
  { fg: 'onChatHeader', bg: 'chatHeader', min: ACCENT_TEXT_MIN, label: 'Chat header text' },
  { fg: 'onChatHeader', bg: 'chatHeaderTo', min: ACCENT_TEXT_MIN, label: 'Chat header text (gradient end)' },
];

export interface ContrastIssue extends ContrastPair {
  ratio: number;
  /** The fg colour that would pass. */
  fix: string;
  /**
   * False when no text colour can pass: the text sits on backgrounds too far
   * apart (very dark background + very light cards, or a black-to-white
   * bubble gradient). The fix is then to change the backgrounds — `advice`.
   */
  fixable: boolean;
  advice: string;
}

const ADVICE: Partial<Record<TokenKey, string>> = {
  ink: 'Your background, cards and panels are too different for one text colour — bring them closer together.',
  onBubbleMine: 'The two ends of your bubble are too different for one text colour — bring them closer together.',
};

export function findContrastIssues(tokens: Tokens): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const p of CONTRAST_PAIRS) {
    const ratio = contrast(tokens[p.fg], tokens[p.bg]);
    if (ratio < p.min) {
      // The fix must keep EVERY background this text sits on readable
      // (your bubble text is on both ends of the gradient), not just this one.
      const against = CONTRAST_PAIRS.filter((q) => q.fg === p.fg).map((q) => ({ bg: tokens[q.bg], ratio: q.min }));
      const fix = ensureContrastAll(tokens[p.fg], against);
      issues.push({
        ...p,
        ratio,
        fix,
        fixable: passesAll(fix, against),
        advice: ADVICE[p.fg] ?? 'Pick a lighter or darker background for this.',
      });
    }
  }
  return issues;
}

/** Ratio for a single token against whatever it's most often drawn on. */
export function contrastFor(key: TokenKey, tokens: Tokens): { ratio: number; min: number } | null {
  const pair = CONTRAST_PAIRS.find((p) => p.fg === key || p.bg === key);
  if (!pair) return null;
  return { ratio: contrast(tokens[pair.fg], tokens[pair.bg]), min: pair.min };
}
