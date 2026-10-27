import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

// This hook no longer decides who's "online" — usePresence handles that.
// Its only job now is keeping `last_seen` fresh so offline users show an
// accurate "last seen X ago" instead of a live/dead flag. That's why the
// interval can be slow (60s) without hurting the online indicator at all.
const LAST_SEEN_PING_MS = 60000;

export function useHeartbeat(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    const pingLastSeen = async () => {
      try {
        await supabase
          .from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', userId);
      } catch (err) {
        console.error('last_seen ping failed:', err);
      }
    };

    pingLastSeen();

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        pingLastSeen();
      }
    }, LAST_SEEN_PING_MS);

    // Pings are skipped while the tab is hidden, so refresh right away on
    // return instead of leaving last_seen up to a minute behind. Also ping
    // on hide: usePresence marks us offline at that same moment, so this
    // makes "last seen" match when we actually left (best-effort — a tab
    // closing too fast may not finish the request; the last ping stands).
    const handleVisibilityChange = () => {
      pingLastSeen();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);
}