import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useOnlineUsers() {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    // 1. Listen to the Presence channel you started in AuthContext
    const channel = supabase.channel('global-presence');

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Convert the presence keys (user IDs) into a Set for fast lookup
        const onlineIds = new Set(Object.keys(state));
        setOnlineUsers(onlineIds);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return onlineUsers; // This returns a Set of User IDs that are currently online
}