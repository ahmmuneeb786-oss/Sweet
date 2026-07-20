import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { emitMessageStored } from './messageBus';

/**
 * App-wide message sync. Mount ONCE at the app root (alongside useOfflineSync).
 *
 * This is the piece that keeps the on-device database (localDB) continuously
 * fresh for EVERY chat, not just the one that's open. A single realtime
 * channel listens for message INSERTs/UPDATEs across all the user's chats
 * (Row-Level Security scopes the stream to messages they're allowed to see —
 * i.e. their own chats — so no client-side chat filter is needed) and writes
 * them straight into localDB.
 *
 * Why it matters: once localDB is always up to date, opening a chat can be a
 * pure local read with no network round trip (that's a later stage). Today it
 * runs additively — it doesn't change how any chat renders, it just populates
 * the cache in the background.
 */

let mounted = false;

const SYNC_KEY = (userId: string) => `sweet_msg_sync_${userId}`;

// Bound only how long a CALLER waits (e.g. the launch splash) — the wrapped
// work keeps running and completes its localDB write regardless, so a slow
// network delays the reveal a little but never loses the caught-up data.
export function waitAtMost<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Catch-up sync: pull every message that was inserted/edited/deleted since the
 * last time we synced (across all the user's chats, RLS-scoped) into localDB.
 * This fills the gap realtime can't — messages that changed while the app was
 * closed or disconnected. Keyed off `updated_at` (bumped by the DB trigger on
 * every change), so it catches new messages AND edits/deletes in one pass.
 * Never throws; always finishes its write (callers bound their own wait via
 * waitAtMost so a slow network can't hang them).
 */
export async function catchUpMessages(userId: string): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const key = SYNC_KEY(userId);
    const since = localStorage.getItem(key);

    // First run on this device/account: don't drag down the whole history —
    // baseline the watermark to now and let the normal loaders populate the
    // initial view. Future runs pull only the delta.
    if (!since) {
      localStorage.setItem(key, new Date().toISOString());
      return;
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*, profiles(display_name, avatar_url, username)')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(1000);
    if (error || !data) return;

    if (data.length > 0) {
      await localDB.messages.bulkPut(data as any);
      // Advance the watermark to the newest change we saw.
      const newest = (data[data.length - 1] as any).updated_at;
      if (newest) localStorage.setItem(key, newest);
    } else {
      localStorage.setItem(key, new Date().toISOString());
    }
  } catch (err) {
    console.warn('Message catch-up failed:', err);
  }
}

export function useMessageSync(userId: string | undefined) {
  useEffect(() => {
    if (!userId || mounted) return;
    mounted = true;
    // First 'SUBSCRIBED' is the initial connect; any SUBSCRIBED after that is a
    // reconnect — including the flaky-internet case where the browser's
    // 'online' event never fires but the realtime socket dropped and came back.
    let wasSubscribed = false;

    const channel = supabase
      .channel('global-message-sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const row = payload.new as any;
          if (!row?.id) return;
          try {
            // Fetch the full row WITH the sender profile join — the realtime
            // payload has the columns but not the join, and cached messages
            // need profiles to render (avatar/name) when the chat is opened.
            const { data, error } = await supabase
              .from('messages')
              .select('*, profiles(display_name, avatar_url, username)')
              .eq('id', row.id)
              .single();
            if (!error && data) {
              await localDB.messages.put(data as any);
              // Push it into the open ChatWindow (if this chat is open) so a
              // message that landed just before the chat was opened still shows
              // without a reload.
              emitMessageStored((data as any).chat_id, data);
            }
          } catch (err) {
            console.warn('Message sync (insert) failed:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        async (payload) => {
          const row = payload.new as any;
          if (!row?.id) return;
          try {
            // Only the mutable fields change on an update — keep the cached
            // profiles join intact.
            await localDB.messages.update(row.id, {
              content: row.content,
              is_edited: row.is_edited,
              is_deleted: row.is_deleted,
              delivery_status: row.delivery_status,
              media_url: row.media_url,
            });
            // Reflect the edit/delete/status change in the open ChatWindow live.
            emitMessageStored(row.chat_id, row);
          } catch (err) {
            console.warn('Message sync (update) failed:', err);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (wasSubscribed) {
            // Reconnected after a drop — silently catch up on anything the
            // socket missed while it was down (the "unstable internet" case).
            catchUpMessages(userId);
          }
          wasSubscribed = true;
        }
      });

    // Also catch up on the browser's reconnect event (a clean offline→online
    // transition), silently — the user knows they were offline.
    const onOnline = () => catchUpMessages(userId);
    window.addEventListener('online', onOnline);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('online', onOnline);
      mounted = false;
    };
  }, [userId]);
}
