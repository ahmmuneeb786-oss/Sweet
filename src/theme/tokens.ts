// The theme vocabulary. Every colour the app paints comes from one of these
// 28 tokens; a theme is just values for them. Users edit 4 "simple" colours
// and every other token is derived (derive.ts) unless they override it.

export const TOKEN_GROUPS = [
  {
    id: 'surfaces',
    label: 'Surfaces',
    tokens: [
      { key: 'bg', label: 'App background' },
      { key: 'panel', label: 'Panels & sidebars' },
      { key: 'card', label: 'Cards' },
      { key: 'cardHover', label: 'Card hover' },
      { key: 'input', label: 'Inputs' },
      { key: 'border', label: 'Borders' },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    tokens: [
      { key: 'ink', label: 'Main text' },
      { key: 'inkSoft', label: 'Secondary text' },
      { key: 'inkFaint', label: 'Faint text' },
      { key: 'link', label: 'Links' },
    ],
  },
  {
    id: 'buttons',
    label: 'Buttons',
    tokens: [
      { key: 'primary', label: 'Main button' },
      { key: 'onPrimary', label: 'Main button text' },
      { key: 'secondary', label: 'Soft button' },
      { key: 'onSecondary', label: 'Soft button text' },
      { key: 'danger', label: 'Danger' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    tokens: [
      { key: 'bubbleMine', label: 'My bubble' },
      { key: 'bubbleMineTo', label: 'My bubble (gradient end)' },
      { key: 'onBubbleMine', label: 'My bubble text' },
      { key: 'bubbleTheirs', label: 'Their bubble' },
      { key: 'onBubbleTheirs', label: 'Their bubble text' },
      { key: 'chatHeader', label: 'Chat header' },
      { key: 'chatHeaderTo', label: 'Chat header (gradient end)' },
      { key: 'onChatHeader', label: 'Chat header text' },
      { key: 'wallpaper', label: 'Chat wallpaper' },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    tokens: [
      { key: 'toggleOn', label: 'Toggle on' },
      { key: 'toggleOff', label: 'Toggle off' },
      { key: 'badge', label: 'Badges & unread' },
      { key: 'online', label: 'Online dot' },
    ],
  },
] as const;

export type TokenKey = (typeof TOKEN_GROUPS)[number]['tokens'][number]['key'];
export type TokenGroupId = (typeof TOKEN_GROUPS)[number]['id'];

export const TOKEN_KEYS: TokenKey[] = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key));

/** Every token resolved to a #RRGGBB hex. */
export type Tokens = Record<TokenKey, string>;

/** The four colours Simple mode edits. Everything else derives from them. */
export interface SimpleColors {
  bg: string;
  card: string;
  ink: string;
  accent: string;
}

export const SIMPLE_FIELDS: { key: keyof SimpleColors; label: string; hint: string }[] = [
  { key: 'bg', label: 'Background', hint: 'Behind everything' },
  { key: 'card', label: 'Cards', hint: 'Lists, panels, their bubbles' },
  { key: 'ink', label: 'Text', hint: 'Words on cards and background' },
  { key: 'accent', label: 'Accent', hint: 'Buttons, your bubbles, toggles' },
];

/** What gets stored for a theme: 4 colours + only the tokens the user pinned. */
export interface ThemeData {
  simple: SimpleColors;
  overrides?: Partial<Tokens>;
}

/** The old three-way theme every not-yet-migrated component still takes. */
export type LegacyTheme = 'light' | 'dark' | 'sweet';

/** CSS custom property for a token, e.g. bubbleMineTo -> --th-bubble-mine-to */
export function cssVar(key: TokenKey): string {
  return `--th-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
}
