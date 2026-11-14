// Which theme a chat is shown in, for THIS user:
//   1. my "Just me" theme for the chat (chat_theme_overrides)
//   2. the chat's "Both of us" theme (chats.shared_theme)
//   3. my app theme
// The chat window paints the result onto itself as CSS variables, so every
// th-* class inside the chat uses the chat's colours while the rest of the
// app keeps the app theme.
import { useMemo, type CSSProperties } from 'react';
import { tokensToVars } from './apply';
import { isDarkColor } from './color';
import { legacyFor, resolveTheme } from './derive';
import { applyChatPreset, getChatPreset } from './presets';
import { cachedSharedTheme, useSharedChatTheme } from './sharedChatTheme';
import type { ChatTheme, UserTheme } from './store';
import { useTheme } from './ThemeProvider';
import type { LegacyTheme, ThemeData, Tokens } from './tokens';

export type ChatThemeSource = 'mine' | 'shared' | 'app';

/** Tokens for a chat theme, laid over the viewer's app theme where it's a preset. */
export function chatThemeTokens(t: ChatTheme, appData: ThemeData, myThemes: UserTheme[]): Tokens {
  if (t.kind === 'preset') {
    const preset = getChatPreset(t.id);
    return preset ? applyChatPreset(appData, preset) : resolveTheme(appData);
  }
  // My own theme: use its latest colours. Someone else's: the copy shared with the chat.
  const latest = t.id ? myThemes.find((m) => m.id === t.id) : undefined;
  return resolveTheme(latest?.data ?? t.data);
}

/** A short label like "💖 Best Friend" or "🎨 My Pink". */
export function chatThemeLabel(t: ChatTheme | null): string {
  if (!t) return 'Default';
  if (t.kind === 'preset') {
    const p = getChatPreset(t.id);
    return p ? `${p.emoji} ${p.name}` : 'Default';
  }
  return `🎨 ${t.name}`;
}

export interface ResolvedChatTheme {
  source: ChatThemeSource;
  /** My "Just me" theme for this chat, if any. */
  mine: ChatTheme | null;
  /** The chat's shared theme, if any, and who set it. */
  shared: ChatTheme | null;
  sharedBy: string | null;
  tokens: Tokens;
  /** CSS variables to put on the chat's root element (undefined = inherit the app theme). */
  style: CSSProperties | undefined;
  /** Closest old light/dark/sweet, for components not on tokens yet. */
  legacy: LegacyTheme;
  /** Readable text colour for the chat header gradient. */
  headerInk: string;
}

export function useChatTheme(chatId: string | undefined): ResolvedChatTheme {
  const { data: appData, tokens: appTokens, library } = useTheme();
  const shared = useSharedChatTheme(chatId);
  const mine = (chatId && library.overrides[chatId]) || null;

  return useMemo(() => {
    const pick = mine ?? shared.theme;
    const source: ChatThemeSource = mine ? 'mine' : shared.theme ? 'shared' : 'app';
    const tokens = pick ? chatThemeTokens(pick, appData, library.themes) : appTokens;
    return {
      source,
      mine,
      shared: shared.theme,
      sharedBy: shared.by,
      tokens,
      // colorScheme: native bits inside the chat (scrollbars, audio player,
      // date pickers) match a dark or light chat theme, whatever the app uses.
      style: source === 'app'
        ? undefined
        : ({ ...tokensToVars(tokens), colorScheme: isDarkColor(tokens.wallpaper) ? 'dark' : 'light' } as CSSProperties),
      legacy: legacyFor(tokens),
      headerInk: tokens.onChatHeader,
    };
  }, [mine, shared.theme, shared.by, appData, appTokens, library.themes]);
}

/**
 * The accent colour of a chat's own theme (my "Just me" one, else the shared
 * one this device has seen), or null when the chat just uses the app theme.
 * For the coloured stripe on themed chats in the chat list.
 */
export function chatAccentFor(chatId: string, overrides: Record<string, ChatTheme>, myThemes: UserTheme[]): string | null {
  const t = overrides[chatId] ?? cachedSharedTheme(chatId).theme;
  if (!t) return null;
  if (t.kind === 'preset') return getChatPreset(t.id)?.accent ?? null;
  const latest = t.id ? myThemes.find((m) => m.id === t.id) : undefined;
  return resolveTheme(latest?.data ?? t.data).bubbleMine;
}
