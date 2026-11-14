// Floating hearts belong to the Sweet theme only — the exact Sweet preset,
// not any theme that merely looks pink. Inside a chat they also need the
// chat to be on the app theme or the Love chat theme; any other chat theme
// turns them off for that chat.
import { useTheme } from './ThemeProvider';
import type { ResolvedChatTheme } from './useChatTheme';

export const SWEET_PRESET_ID = 'sweet';

/** True when the app theme is the Sweet preset. */
export function useAppIsSweet(): boolean {
  const { active } = useTheme();
  return active.kind === 'preset' && active.id === SWEET_PRESET_ID;
}

/** Whether a chat shows hearts behind its messages. */
export function chatShowsHearts(appIsSweet: boolean, chat: ResolvedChatTheme): boolean {
  if (!appIsSweet) return false;
  const pick = chat.mine ?? chat.shared;
  return !pick || (pick.kind === 'preset' && pick.id === 'love');
}
