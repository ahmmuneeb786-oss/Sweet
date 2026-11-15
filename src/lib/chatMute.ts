import { supabase } from './supabase';

/*
  Chat mute, in one place (ChatMenu + Settings > Notifications use it).
  Matches the server (send-sweet-push): is_muted with no end date = muted
  forever; with an end date = muted until then, then automatically live again.
*/

export type MuteDuration = '8h' | '1w' | 'forever';

export interface MuteState {
  muted: boolean;
  /** null while muted = forever */
  until: Date | null;
}

export function readMute(isMuted: boolean | null | undefined, mutedUntil: string | null | undefined): MuteState {
  if (!isMuted) return { muted: false, until: null };
  if (!mutedUntil) return { muted: true, until: null };
  const until = new Date(mutedUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return { muted: false, until: null };
  return { muted: true, until };
}

/** "7h left", "3d left", "forever" */
export function muteLeftLabel(state: MuteState): string {
  if (!state.muted) return '';
  if (!state.until) return 'forever';
  const mins = Math.max(1, Math.round((state.until.getTime() - Date.now()) / 60000));
  if (mins < 60) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

/** duration null = unmute. Returns the new state, or throws on failure. */
export async function setChatMute(chatId: string, userId: string, duration: MuteDuration | null): Promise<MuteState> {
  const until =
    duration === '8h' ? new Date(Date.now() + 8 * 60 * 60 * 1000)
    : duration === '1w' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : null;
  const { error } = await supabase
    .from('chat_participants')
    .update({ is_muted: duration !== null, muted_until: until ? until.toISOString() : null })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
  if (error) throw error;
  return { muted: duration !== null, until };
}
