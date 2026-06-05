import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useHeartbeat(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    let intervalId: NodeJS.Timeout;

    const sendPing = async () => {
      try {
        await supabase
          .from('profiles')
          .update({
            last_seen: new Date().toISOString(),
          })
          .eq('id', userId);
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendPing();
      }
    };

    const setOffline = async () => {
      try {
        await supabase
          .from('profiles')
          .update({
            last_seen: new Date().toISOString(),
          })
          .eq('id', userId);
      } catch (err) {
        console.error('Offline update failed:', err);
      }
    };

    // initial ping
    sendPing();

    // interval ping
    intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        sendPing();
      }
    }, 15000);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', setOffline);
    window.addEventListener('pagehide', setOffline);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', setOffline);
      window.removeEventListener('pagehide', setOffline);

      setOffline().catch(() => {});
    };
  }, [userId]);
}