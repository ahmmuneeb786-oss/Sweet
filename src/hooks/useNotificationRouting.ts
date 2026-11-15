import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { PermissionManager } from '../services/PermissionManager';
import { syncTimezone } from '../lib/notificationPrefs';

/*
  Where a tapped notification takes you.

  Two ways in, both handled here for both dashboards:
   - App already open: the service worker focuses it and posts
     { type: 'sweet:open-chat', chatId } or { type: 'sweet:open-friends' }.
   - App was closed: the worker opens /?chat=<id> or /?friends=1, read once
     on start and then removed from the address bar (so a refresh or the back
     button doesn't re-open it).

  Also re-registers this device when the worker reports the browser rotated
  its push subscription ('sweet:resubscribe').

  Locked (vault) chats are never opened from here: the server leaves their id
  out of the notification, and as a second guard a chat marked locked is
  skipped, so a link can't walk around the vault.
*/

/**
 * Read once when the app loads (/?chat=<id> or /?friends=1 from a tapped
 * notification) and removed from the address bar straight away, so a refresh
 * or the back button can't re-open it. Waits here until a dashboard mounts —
 * e.g. after sign-in or the app lock.
 */
let coldStart: { chat: string | null; friends: boolean } | null = (() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const chat = params.get('chat');
  const friends = params.get('friends') === '1';
  if (!chat && !friends) return null;
  params.delete('chat');
  params.delete('friends');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  return { chat, friends };
})();

interface Handlers {
  userId: string | undefined;
  openChat: (chatId: string) => void;
  openFriendRequests: () => void;
}

async function isLockedForMe(chatId: string, userId: string): Promise<boolean> {
  try {
    const cached = await localDB.chats.get(chatId);
    if (cached?.is_locked) return true;
  } catch {
    // no local copy — ask the server below
  }
  if (!navigator.onLine) return false;
  const { data } = await supabase
    .from('chat_participants')
    .select('is_locked')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data?.is_locked;
}

export function useNotificationRouting({ userId, openChat, openFriendRequests }: Handlers) {
  // Latest handlers without re-subscribing listeners on every render.
  const ref = useRef({ openChat, openFriendRequests });
  ref.current = { openChat, openFriendRequests };

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Bedtime Jars run on the server in the user's timezone — keep it current
    // (one write only when it changed, e.g. after travelling).
    void syncTimezone(userId);

    /** true = dealt with (opened, or refused on purpose); false = effect was torn down first. */
    const goToChat = async (chatId: string): Promise<boolean> => {
      if (!chatId || chatId.length > 200) return true;
      if (await isLockedForMe(chatId, userId)) return true;
      if (cancelled) return false;
      ref.current.openChat(chatId);
      return true;
    };

    // Cold start from a notification. Cleared only once it was really
    // handled, so React StrictMode's mount → unmount → mount in dev (which
    // cancels the first run mid-await) still opens the chat on the second run.
    const pending = coldStart;
    if (pending?.chat) {
      void goToChat(pending.chat).then((handled) => { if (handled && coldStart === pending) coldStart = null; });
    } else if (pending?.friends) {
      coldStart = null;
      ref.current.openFriendRequests();
    }

    if (!('serviceWorker' in navigator)) return () => { cancelled = true; };

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; chatId?: string } | null;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'sweet:open-chat' && typeof msg.chatId === 'string') void goToChat(msg.chatId);
      if (msg.type === 'sweet:open-friends') ref.current.openFriendRequests();
      if (msg.type === 'sweet:resubscribe' && 'Notification' in window && Notification.permission === 'granted') {
        void PermissionManager.setupPushSubscription(userId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [userId]);
}
