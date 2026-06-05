import { useEffect } from 'react';
import { localDB } from '../db';
import { supabase } from '../lib/supabase';

export function OfflineSyncEngine() {
  useEffect(() => {
    // 1. Listen for when the browser changes from offline back to online
    const handleOnline = () => {
      console.log('🌐 Connection re-established! Triggering background sync sequence...');
      processSyncQueue();
    };

    window.addEventListener('online', handleOnline);
    
    // 2. Also run an optimization check immediately on mount if already online
    if (navigator.onLine) {
      processSyncQueue();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, []);

  async function processSyncQueue() {
    try {
      // Fetch the current active user session status from Supabase authentication
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      // 🌸 PROFILE SYNC CHECK: Pull cached values from Dexie
      const cachedProfile = await localDB.getUserProfile(authUser.id);
      if (cachedProfile) {
        console.log('🔄 Syncing updated local profile fields up to the cloud...');
        
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            display_name: cachedProfile.display_name,
            bio: cachedProfile.bio,
            avatar_url: cachedProfile.avatar_url,
            username: cachedProfile.username
          })
          .eq('id', authUser.id);

        if (!profileError) {
          console.log('✅ Cloud user profile successfully updated!');
        }
      }

      // 🌸 OPTIONAL MESSAGE OUTBOX SYNC: Clear out background unsent chat lists here...
      // (If you have an unsent messages table set up in your dexie structure)

    } catch (err) {
      console.error('Background sync task failed:', err);
    }
  }

  return null; // This component runs purely in the background and renders no visual markup
}