import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * App-wide online presence, backed by Supabase Realtime Presence.
 *
 * Why this instead of a heartbeat + beforeunload write to `last_seen`:
 * Presence tracks the *websocket connection itself*. When it drops — tab
 * closed, crash, force-quit, network loss, whatever — Supabase's realtime
 * server detects the disconnect and fires a "leave" event for us. We are
 * not relying on the browser successfully firing an unload event and
 * completing a network request in time, which is the part that was failing.
 *
 * Only ONE realtime channel is ever opened for the whole app, no matter how
 * many components call usePresence() (ChatWindow, a chat list, a profile
 * page, etc.) — they all share the same underlying subscription via this
 * module-level singleton.
 */

let sharedOnlineIds = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();

function notifyListeners() {
  const snapshot = new Set(sharedOnlineIds);
  listeners.forEach((cb) => cb(snapshot));
}

let channel: ReturnType<typeof supabase.channel> | null = null;
let consumerCount = 0;

function ensureChannel(userId: string) {
  if (channel) return channel;

  channel = supabase.channel('online-users', {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel!.presenceState();
      sharedOnlineIds = new Set(Object.keys(state));
      notifyListeners();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel!.track({ online_at: new Date().toISOString() });
      }
    });

  return channel;
}

export function usePresence(userId: string | undefined) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set(sharedOnlineIds));

  useEffect(() => {
    if (!userId) return;

    consumerCount++;
    ensureChannel(userId);
    listeners.add(setOnlineIds);
    setOnlineIds(new Set(sharedOnlineIds));

    return () => {
      listeners.delete(setOnlineIds);
      consumerCount--;

      // Only tear the channel down once EVERY consumer (including whatever
      // you mount at the app root) has unmounted — i.e. real logout/app close.
      // A single ChatWindow closing should NOT mark you offline to others.
      if (consumerCount <= 0 && channel) {
        channel.untrack();
        supabase.removeChannel(channel);
        channel = null;
        sharedOnlineIds = new Set();
      }
    };
  }, [userId]);

  return {
    onlineIds,
    isOnline: (id: string | undefined | null) => (id ? onlineIds.has(id) : false),
  };
}