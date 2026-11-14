// Built-in themes. App presets are whole themes; chat presets only recolour
// the chat (accent + bubble gradient) on top of whatever app theme the
// viewer uses, so a Love chat still looks right in a dark app.
import type { ThemeData, Tokens, LegacyTheme } from './tokens';
import { resolveTheme } from './derive';

export interface AppPreset {
  id: string;
  name: string;
  emoji: string;
  data: ThemeData;
}

export const APP_PRESETS: AppPreset[] = [
  {
    id: 'sweet',
    name: 'Sweet',
    emoji: '🍬',
    // Hand-designed by the app's owner. Every token is pinned to the colours
    // Sweet had before the theme system (commit fe3e1fb), so no derive or
    // readability rule ever changes it. Don't "fix" these; ask the owner.
    // Where old Sweet used several colours for one role, the most-seen one
    // won; blended values reproduce old see-through tints over Sweet's
    // surfaces (e.g. cardHover = #FFC0CB at 30% over #FFF0F5).
    data: {
      simple: { bg: '#FFF0F5', card: '#FFFFFF', ink: '#4B004B', accent: '#FF1493' },
      overrides: {
        panel: '#FFF0F5', cardHover: '#FFE2E8', input: '#FFF0F5', border: '#FFB6C1',
        inkSoft: '#8B004B', inkFaint: '#C578A0', link: '#FF1493',
        onPrimary: '#FFFFFF', secondary: '#FFE4E1', onSecondary: '#8B004B', danger: '#DC2626',
        bubbleMine: '#FF69B4', bubbleMineTo: '#FF1493', onBubbleMine: '#FFFFFF',
        bubbleTheirs: '#FFF2F0', onBubbleTheirs: '#8B004B',
        chatHeader: '#FF69B4', chatHeaderTo: '#FFC0CB', onChatHeader: '#FFFFFF',
        wallpaper: '#FFE4E1',
        toggleOn: '#FF1493', toggleOff: '#FFD1DC', badge: '#FF1493', online: '#22C55E',
      },
    },
  },
  {
    id: 'light',
    name: 'Light',
    emoji: '☀️',
    data: {
      simple: { bg: '#F9FAFB', card: '#FFFFFF', ink: '#111827', accent: '#EC4899' },
      overrides: { panel: '#FFFFFF', border: '#E5E7EB', inkSoft: '#4B5563' },
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    emoji: '🌙',
    data: {
      simple: { bg: '#140B17', card: '#21142A', ink: '#F7E8F2', accent: '#FF4FA3' },
    },
  },
  {
    id: 'cotton-candy',
    name: 'Cotton Candy',
    emoji: '🍭',
    data: {
      simple: { bg: '#F4EEFF', card: '#FFFFFF', ink: '#3B1F5C', accent: '#9B5CFF' },
      overrides: { bubbleMineTo: '#FF8FD1', chatHeader: '#B57BFF' },
    },
  },
  {
    id: 'mint-choc',
    name: 'Mint Choc',
    emoji: '🍫',
    data: {
      simple: { bg: '#1C1512', card: '#2A201B', ink: '#F3ECE6', accent: '#3DD6A3' },
    },
  },
  {
    id: 'honey-milk',
    name: 'Honey Milk',
    emoji: '🍯',
    data: {
      simple: { bg: '#FFF8EC', card: '#FFFFFF', ink: '#4A2E05', accent: '#F59E0B' },
      overrides: { bubbleMineTo: '#FFD27A' },
    },
  },
  {
    id: 'blueberry-night',
    name: 'Blueberry Night',
    emoji: '💙',
    data: {
      simple: { bg: '#0E1326', card: '#1A2140', ink: '#E6EBFF', accent: '#5B8CFF' },
      overrides: { bubbleMineTo: '#9B7BFF' },
    },
  },
];

export const DEFAULT_PRESET_ID = 'sweet';

/** The three old theme names map onto these presets. */
export const LEGACY_PRESET: Record<LegacyTheme, string> = {
  sweet: 'sweet',
  light: 'light',
  dark: 'midnight',
};

export function getAppPreset(id: string | null | undefined): AppPreset | undefined {
  return APP_PRESETS.find((p) => p.id === id);
}

// ---- Chat presets ---------------------------------------------------------

export interface ChatPreset {
  id: 'love' | 'best_friend' | 'friend';
  name: string;
  emoji: string;
  accent: string;
  to: string;
}

export const CHAT_PRESETS: ChatPreset[] = [
  { id: 'love', name: 'Love', emoji: '💕', accent: '#E8336F', to: '#FF4F9A' },
  { id: 'best_friend', name: 'Best Friend', emoji: '💖', accent: '#FF1493', to: '#B14BFF' },
  { id: 'friend', name: 'Friend', emoji: '🌸', accent: '#E0457B', to: '#F2683C' },
];

export function getChatPreset(id: string | null | undefined): ChatPreset | undefined {
  return CHAT_PRESETS.find((p) => p.id === id);
}

/** Tokens that a chat theme takes over; the viewer's own pins for these are dropped. */
const CHAT_OWNED: (keyof Tokens)[] = ['bubbleMine', 'bubbleMineTo', 'onBubbleMine', 'chatHeader', 'chatHeaderTo', 'onChatHeader', 'wallpaper', 'primary', 'onPrimary', 'toggleOn', 'badge', 'link'];

/** A chat preset laid over the viewer's app theme. */
export function applyChatPreset(base: ThemeData, preset: ChatPreset): Tokens {
  const overrides = { ...(base.overrides ?? {}) };
  for (const k of CHAT_OWNED) delete overrides[k];
  overrides.bubbleMineTo = preset.to;
  return resolveTheme({ simple: { ...base.simple, accent: preset.accent }, overrides });
}
