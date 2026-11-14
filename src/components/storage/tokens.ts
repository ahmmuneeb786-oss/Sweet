// Look of the Storage & Media ("Candy Jar") screens. Built on the same
// styles() the App Lock and Locked Chats tabs use, so every settings tab
// reads as one family; only the candy flavours and the jar itself are extra.
import { styles } from '../LockedChatsSettings';

export type AppTheme = 'light' | 'dark' | 'sweet';

/** One candy flavour per kind of stored data — the jar's layers. */
export const CANDY = {
  photos: { label: 'Photos', emoji: '🍓', base: '#FF5C93', light: '#FFA3C2', deep: '#D93A72' },
  messages: { label: 'Messages', emoji: '🍇', base: '#A06BFF', light: '#CDB0FF', deep: '#7B45E0' },
  waiting: { label: 'Pendings', emoji: '🍯', base: '#FFB547', light: '#FFD993', deep: '#E0901F' },
  other: { label: 'App & Face Lock', emoji: '🍃', base: '#3DD6A3', light: '#A2F0D6', deep: '#1FAF80' },
} as const;

export type CandyKey = keyof typeof CANDY;

export function tokens(theme: AppTheme) {
  const s = styles(theme);
  const dark = theme === 'dark';
  return {
    ...s,
    /** Section label, e.g. "CANDY WRAPPERS" — same as the lock tabs. */
    sectionLabel: `text-[10px] font-bold uppercase tracking-[0.2em] ${s.section}`,
    /** Small selectable pill (filters, options). */
    pill: s.secondary,
    pillOn: s.primary,
    divider: 'border-th-border',
    track: 'bg-th-toggle-off',
    // Theme colours as CSS colour strings — CandyJar puts them in `style`
    // (SVG attributes don't reliably take CSS variables).
    jarStroke: 'rgb(var(--th-primary))',
    jarGlass: dark ? 'rgb(var(--th-card) / 0.35)' : 'rgb(var(--th-card) / 0.8)',
    lid: ['rgb(var(--th-primary))', 'rgb(var(--th-card))'] as [string, string],
  };
}

export type Tokens = ReturnType<typeof tokens>;

/** Soft candy tint behind an icon (12% / 22% alpha hex suffix). */
export function candyTint(k: CandyKey, dark: boolean) {
  return `${CANDY[k].base}${dark ? '38' : '1F'}`;
}
