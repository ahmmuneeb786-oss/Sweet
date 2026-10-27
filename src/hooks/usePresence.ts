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
let isSubscribed = false;

// While WE are disconnected no presence events arrive, so the last snapshot
// would keep showing everyone as online indefinitely. We genuinely don't know
// who's online then — show nobody until the channel rejoins and a fresh
// 'sync' repopulates the set.
function clearOnlineIds() {
  if (sharedOnlineIds.size === 0) return;
  sharedOnlineIds = new Set();
  notifyListeners();
}

function syncFromChannel() {
  if (!channel) return;
  sharedOnlineIds = new Set(Object.keys(channel.presenceState()));
  notifyListeners();
}

// A short network blip — or DevTools "Offline", which doesn't touch an open
// websocket — can leave the channel joined the whole time. Then no rejoin
// and no 'sync' follow, so nothing would refill the set we cleared on
// 'offline'. The channel's presence state is still current, so rebuild from
// it. If the socket really did die, the rejoin's own 'sync' corrects this.
function handleOnline() {
  if (isSubscribed) syncFromChannel();
}

// "Online" means the app is open on screen right now. Announcing only while
// visible, and saying goodbye (untrack) the moment we're hidden, lets
// partners see us leave within ~1s for tab switches, app switches, screen
// locks and tab closes — instead of waiting 30–60s for the server to notice
// our socket went silent. Crashes / sudden network loss can't send the
// goodbye; the server timeout still catches those.
function trackSelf() {
  if (!channel || !isSubscribed || document.visibilityState !== 'visible') return;
  channel.track({ online_at: new Date().toISOString() }).catch(() => {});
}

function handleVisibilityChange() {
  if (!channel || !isSubscribed) return;
  if (document.visibilityState === 'visible') {
    trackSelf();
  } else {
    // No delay on purpose: mobile browsers often freeze timers as soon as a
    // page is hidden, so a deferred goodbye would frequently never be sent.
    channel.untrack().catch(() => {});
  }
}

function ensureChannel(userId: string) {
  if (channel) return channel;

  channel = supabase.channel('online-users', {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      // The socket can outlive the browser's "offline" — don't let a late
      // sync bring dots back while we're telling the user they're offline.
      if (!navigator.onLine) return;
      syncFromChannel();
    })
    .subscribe(async (status) => {
      isSubscribed = status === 'SUBSCRIBED';
      if (status === 'SUBSCRIBED') {
        // A rejoin can happen while we're in the background — only announce
        // if visible; otherwise handleVisibilityChange tracks us on return.
        trackSelf();
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED — realtime-js retries the join
        // on its own and we re-track on the next SUBSCRIBED.
        clearOnlineIds();
      }
    });

  // The browser usually reports a lost network well before the websocket
  // times out, so clear right away instead of waiting on the channel status.
  window.addEventListener('offline', clearOnlineIds);
  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

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
        window.removeEventListener('offline', clearOnlineIds);
        window.removeEventListener('online', handleOnline);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        isSubscribed = false;
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