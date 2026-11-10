import { supabase } from './supabase';

// The ONE "Saved Messages" chat per user. Every entry point (signup, the
// friend list's Saved Messages row, the chat list, the chat window) must go
// through these helpers so they all land on the same chat id — earlier,
// different code paths built different ids (`self-<uid>`, `<uid>`,
// `<uid>_self-<uid>`) and messages ended up split across them.

export const SELF_CHAT_NAME = 'Saved Messages';
const PREFIX = 'self-';

export const selfChatId = (userId: string) => `${PREFIX}${userId}`;
export const isSelfChatId = (chatId: string | null | undefined) => !!chatId && chatId.startsWith(PREFIX);

/**
 * Idempotently make sure the self chat AND its participant row exist on the
 * server. The participant row matters most: RLS only lets a user see a chat
 * (and its messages) through chat_participants, so a chat row without it is
 * invisible to ChatList and ChatWindow. Throws if either write fails.
 */
export async function ensureSelfChat(userId: string): Promise<string> {
  const id = selfChatId(userId);

  const { error: chatError } = await supabase
    .from('chats')
    .upsert(
      { id, type: 'direct', name: SELF_CHAT_NAME, created_by: userId },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  if (chatError) throw chatError;

  const { error: participantError } = await supabase
    .from('chat_participants')
    .upsert(
      { chat_id: id, user_id: userId, role: 'admin' },
      { onConflict: 'chat_id,user_id', ignoreDuplicates: true }
    );
  if (participantError) throw participantError;

  return id;
}
