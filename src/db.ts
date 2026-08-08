import Dexie, { type Table } from 'dexie';

// Structure of a chat saved locally
export interface LocalChat {
  id: string;              
  type: 'direct' | 'group'; 
  name: string | null;      
  avatar_url: string | null;
  theme: string;            
  last_message_content?: string | null;
  last_message_time?: string;
  // Carried so the chat-list preview can label by kind (Photo/GIF/Voice/…)
  // and show "Deleted message" — not just dump the raw content string.
  last_message_type?: string | null;
  last_message_is_deleted?: boolean;
  last_message_id?: string;
  // Count of unread (received, not-yet-read) messages — the chat-list badge.
  unread_count?: number;

  other_user_id?: string;
  other_user_name?: string;
  other_user_avatar?: string | null;
  other_user_last_seen?: string | null;
}

// Structure for caching user profiles locally
export interface LocalProfile {
  id: string; // The user's account ID (primary key)
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string | null;
  cached_at: string; // Timestamp to trace database freshness
  pending_sync?: boolean; // true = this copy has edits Supabase doesn't have yet
  face_descriptor?: number[] | null; // cached locally for instant, offline-capable face-lock scans
  face_lock_enabled?: boolean; // cached alongside it so the lock itself works offline, not just the scan speed
}

// A message as cached locally — mirrors MessageType in ChatWindow/Message,
// with two extra delivery_status values ('pending' and 'failed') to represent
// messages that couldn't reach the server yet.
export interface LocalMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read' | 'pending' | 'failed';
  profiles: {
    display_name: string;
    avatar_url: string | null;
    username: string;
  };
}

// A message queued in the outbox — created the moment a send fails (whether
// because we're offline, or the request genuinely errored). `media_blob`
// carries the actual file/audio-blob so media can still be uploaded once
// we're back online, since a blob URL alone means nothing to the server.
export interface PendingMessage {
  id: string; // same id as the optimistic LocalMessage — keeps them in sync
  chat_id: string;
  sender_id: string;
  content: string | null;
  message_type: string; // 'text' | 'image' | 'voice' | 'file' | 'video' | 'gif'
  media_blob?: Blob;
  media_file_name?: string;
  // Already-hosted media (e.g. a picked GIF) that needs no upload at all —
  // just re-insert with this URL once we're back online.
  media_url?: string | null;
  // The message this one replies to, if any — re-inserted once back online.
  reply_to_id?: string | null;
  created_at: string;
  attempts: number;
  last_error?: string | null;
}

class OfflineChatDatabase extends Dexie {
  chats!: Table<LocalChat>;
  messages!: Table<LocalMessage, string>;
  profiles!: Table<LocalProfile, string>;
  pendingMessages!: Table<PendingMessage, string>;

  constructor() {
    super('WhatsAppOfflineDB');
    this.version(2).stores({ 
      chats: 'id, type',
      messages: 'id, chat_id, created_at',
      profiles: 'id, username' 
    });

    // v3: index other_user_id so we can query/modify a chat's cached row by
    // the other participant's id (used to keep last_seen fresh from realtime
    // profile updates without refetching everything).
    this.version(3).stores({
      chats: 'id, type, other_user_id',
      messages: 'id, chat_id, created_at',
      profiles: 'id, username'
    });

    // v4: add the offline outbox. Messages that fail to send (offline or
    // otherwise) get queued here and replayed automatically on reconnect.
    this.version(4).stores({
      chats: 'id, type, other_user_id',
      messages: 'id, chat_id, created_at',
      profiles: 'id, username',
      pendingMessages: 'id, chat_id, created_at'
    });
  }

  // Pass { pendingSync: true } when saving an edit made offline (or one that
  // failed to reach the server) — that's what tells useOfflineSync there's
  // something here worth pushing up on reconnect. Omit it (or pass false)
  // when just mirroring the server's own data locally.
  async saveUserProfile(userId: string, profileData: any, options?: { pendingSync?: boolean }) {
    // put() REPLACES the entire record — without reading the existing row
    // first, any save that doesn't explicitly pass face_descriptor/
    // face_lock_enabled (which is every caller except the dedicated face
    // helpers below) would silently wipe them back to nothing. This was
    // firing on essentially every app load via ChatList's hydrateMyProfile,
    // which is what caused the face-lock splash timing bug.
    const existing = await this.profiles.get(userId);
    return await this.profiles.put({
      id: userId,
      username: profileData.username || '',
      display_name: profileData.display_name || '',
      avatar_url: profileData.avatar_url || null,
      bio: profileData.bio || null,
      created_at: profileData.created_at || null,
      cached_at: new Date().toISOString(),
      pending_sync: options?.pendingSync ?? false,
      face_descriptor: existing?.face_descriptor ?? null,
      face_lock_enabled: existing?.face_lock_enabled ?? false,
    });
  }

  async getUserProfile(userId: string): Promise<LocalProfile | undefined> {
    return await this.profiles.get(userId);
  }

  // Dedicated helpers for face-lock data specifically — deliberately NOT
  // routed through saveUserProfile/getUserProfile. That method does a full
  // put() (a complete overwrite); if this went through it without every
  // other field also being passed in, it would silently wipe
  // display_name/avatar_url/etc. (or vice versa, wipe face data on an
  // unrelated profile edit). A targeted update() touches only these two
  // fields, no matter what else is being saved/edited elsewhere.
  async saveFaceLockDataLocally(userId: string, descriptor: number[] | null, enabled: boolean) {
    const updated = await this.profiles.update(userId, {
      face_descriptor: descriptor,
      face_lock_enabled: enabled,
    });
    if (!updated) {
      // No cached profile row exists yet for this user at all — create a
      // minimal one rather than silently losing this data.
      await this.profiles.put({
        id: userId,
        username: '',
        display_name: '',
        avatar_url: null,
        bio: null,
        created_at: null,
        cached_at: new Date().toISOString(),
        face_descriptor: descriptor,
        face_lock_enabled: enabled,
      });
    }
  }

  async getFaceLockDataLocally(userId: string): Promise<{ descriptor: number[] | null; enabled: boolean } | null> {
    const profile = await this.profiles.get(userId);
    if (!profile) return null;
    return {
      descriptor: profile.face_descriptor ?? null,
      enabled: !!profile.face_lock_enabled,
    };
  }

  // Wipe every locally-cached table. Call this on logout — the cache isn't
  // scoped per-account (chats/messages/profiles are keyed only by their own
  // id, not by which user is signed in), so without this, logging into a
  // DIFFERENT account on the same device would show the previous account's
  // cached chats and messages, since chat/message loading trusts whatever is
  // already in localDB. Clearing on sign-out means each account always starts
  // from a clean local cache and re-populates from scratch (or from a fresh
  // catch-up sync) on next login.
  async clearAllLocalData() {
    await Promise.all([
      this.chats.clear(),
      this.messages.clear(),
      this.profiles.clear(),
      this.pendingMessages.clear(),
    ]);
  }
}

export const localDB = new OfflineChatDatabase();