import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { localDB, type PendingMessage } from '../db';

/**
 * The offline send queue.
 *
 * When a message fails to send — because the device is offline, or the
 * request genuinely errors — it gets written to `localDB.pendingMessages`
 * instead of being discarded. This module is the thing that later turns
 * a queued message back into a real one:
 *
 *   1. Upload the attached file/blob (if any) to the right storage bucket.
 *   2. Insert the message row in Supabase.
 *   3. Update the local cache (`localDB.messages`, `localDB.chats`) to reflect
 *      the real result, and remove the item from the outbox.
 *   4. Tell any currently-open ChatWindow so it can update the message bubble
 *      live, without needing a full reload.
 *
 * Mount `useOfflineSync()` ONCE at your app root (same place you mount
 * usePresence) so queued messages keep syncing even if the user has
 * navigated away from that specific chat.
 */

type SyncResult =
  | { status: 'sent'; id: string; media_url: string | null }
  | { status: 'failed'; id: string; error: string; permanent: boolean };

const listeners = new Map<string, Set<(result: SyncResult) => void>>();

function notify(chatId: string, result: SyncResult) {
  listeners.get(chatId)?.forEach((cb) => cb(result));
}

/** Let a ChatWindow react live when one of ITS chat's queued messages resolves. */
export function subscribeToSyncEvents(chatId: string, callback: (result: SyncResult) => void) {
  if (!listeners.has(chatId)) listeners.set(chatId, new Set());
  listeners.get(chatId)!.add(callback);
  return () => {
    listeners.get(chatId)?.delete(callback);
  };
}

const BUCKET_BY_TYPE: Record<string, string> = {
  image: 'chat-media',
  video: 'chat-media',
  voice: 'voice-notes',
  file: 'chat-docs',
};

async function uploadPendingMedia(pending: PendingMessage): Promise<string | null> {
  if (!pending.media_blob) return null;

  const bucket = BUCKET_BY_TYPE[pending.message_type] || 'chat-media';
  const fileName = pending.media_file_name || `${pending.id}`;
  const filePath = `${pending.sender_id}/${Date.now()}_${fileName}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, pending.media_blob);
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/** Queue a message that failed to send. Call this from the send catch block. */
export async function queuePendingMessage(pending: PendingMessage) {
  await localDB.pendingMessages.put(pending);
  await localDB.messages.update(pending.id, { delivery_status: 'pending' });
}

/** Attempt to actually send one queued message. Used by both auto-sync and manual "tap to retry". */
export async function sendPendingMessage(pending: PendingMessage): Promise<SyncResult> {
  try {
    const mediaUrl = await uploadPendingMedia(pending);

    const { error } = await supabase.from('messages').insert({
      id: pending.id,
      chat_id: pending.chat_id,
      sender_id: pending.sender_id,
      content: pending.content,
      type: pending.message_type,
      media_url: mediaUrl,
      delivery_status: 'sent',
    });
    if (error) throw error;

    await localDB.messages.update(pending.id, { delivery_status: 'sent', media_url: mediaUrl });
    await localDB.chats.update(pending.chat_id, {
      last_message_content: pending.content || (pending.media_file_name ? pending.media_file_name : 'Media'),
      last_message_time: new Date().toISOString(),
    });
    await localDB.pendingMessages.delete(pending.id);

    const result: SyncResult = { status: 'sent', id: pending.id, media_url: mediaUrl };
    notify(pending.chat_id, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await localDB.pendingMessages.update(pending.id, {
      attempts: (pending.attempts || 0) + 1,
      last_error: message,
    });

    // After a few failed attempts that aren't just "we're offline", stop
    // auto-retrying and let the user tap to retry manually instead.
    const attempts = (pending.attempts || 0) + 1;
    const permanent = attempts >= 5 && navigator.onLine;
    if (permanent) {
      await localDB.messages.update(pending.id, { delivery_status: 'failed' });
    }

    const result: SyncResult = { status: 'failed', id: pending.id, error: message, permanent };
    notify(pending.chat_id, result);
    return result;
  }
}

/**
 * Offline PROFILE sync — this is the piece OfflineSyncEngine.tsx was meant to
 * be, folded in here so there's one sync system instead of two. Key
 * difference from that draft: it only pushes to Supabase when the cached
 * profile is actually marked `pending_sync` (a real unsynced local edit).
 * The old version pushed the local cache on every single reconnect
 * unconditionally, which risked overwriting newer server-side data (e.g.
 * from another device) with a stale local mirror.
 */

type ProfileSyncResult = { status: 'synced' } | { status: 'failed'; error: string };

const profileListeners = new Set<(result: ProfileSyncResult) => void>();

function notifyProfile(result: ProfileSyncResult) {
  profileListeners.forEach((cb) => cb(result));
}

/** Let ProfileSidebar (or any component) react live when the offline profile edit finishes syncing. */
export function subscribeToProfileSyncEvents(callback: (result: ProfileSyncResult) => void) {
  profileListeners.add(callback);
  return () => {
    profileListeners.delete(callback);
  };
}

function base64ToBlob(base64: string): { blob: Blob; contentType: string } {
  const [header, data] = base64.split(',');
  const contentType = header.match(/data:(.*);base64/)?.[1] || 'image/jpeg';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

async function flushProfile() {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return;

  const cached = await localDB.getUserProfile(authUser.id);
  if (!cached || !cached.pending_sync) return; // nothing unsynced — don't touch the server at all

  try {
    let avatarUrl = cached.avatar_url;

    // An offline avatar change is stored as base64 (there's no server URL for
    // it yet). Upload it to storage now so we push a real URL, not a giant
    // base64 string, into the profiles table.
    if (avatarUrl && avatarUrl.startsWith('data:')) {
      const { blob, contentType } = base64ToBlob(avatarUrl);
      const ext = contentType.split('/')[1] || 'jpg';
      const filePath = `${authUser.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, blob);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      avatarUrl = data.publicUrl;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: cached.display_name,
        bio: cached.bio,
        avatar_url: avatarUrl,
        username: cached.username,
      })
      .eq('id', authUser.id);
    if (error) throw error;

    await localDB.saveUserProfile(authUser.id, { ...cached, avatar_url: avatarUrl }, { pendingSync: false });
    notifyProfile({ status: 'synced' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Profile sync failed, will retry next reconnect:', message);
    notifyProfile({ status: 'failed', error: message });
  }
}

let flushing = false;

async function flushAll() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const queued = await localDB.pendingMessages.orderBy('created_at').toArray();
    for (const pending of queued) {
      // Re-check between iterations — connection may drop mid-flush.
      if (!navigator.onLine) break;
      await sendPendingMessage(pending);
    }
    if (navigator.onLine) {
      await flushProfile();
    }
  } finally {
    flushing = false;
  }
}

let rootMounted = false;

/** Mount once at the app root. Drains the message outbox AND any pending profile edit, on load and whenever the connection returns. */
export function useOfflineSync() {
  useEffect(() => {
    if (rootMounted) return;
    rootMounted = true;

    flushAll();
    window.addEventListener('online', flushAll);

    return () => {
      window.removeEventListener('online', flushAll);
      rootMounted = false;
    };
  }, []);
}

/** Manual "tap to retry" — reuses the exact same send path as auto-sync. */
export async function retryPendingMessage(id: string): Promise<SyncResult> {
  const pending = await localDB.pendingMessages.get(id);
  if (!pending) {
    return { status: 'failed', id, error: 'Nothing queued for this message anymore.', permanent: true };
  }
  return sendPendingMessage(pending);
}