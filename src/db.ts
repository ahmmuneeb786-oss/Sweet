import Dexie, { type Table } from 'dexie';

// Structure of a chat saved locally
export interface LocalChat {
  id: string;              
  type: 'direct' | 'group'; 
  name: string | null;      
  avatar_url: string | null;
  theme: string;            
  last_message_content?: string;
  last_message_time?: string;

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
  message_type: string; // 'text' | 'image' | 'voice' | 'file' | 'video'
  media_blob?: Blob;
  media_file_name?: string;
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
    return await this.profiles.put({
      id: userId,
      username: profileData.username || '',
      display_name: profileData.display_name || '',
      avatar_url: profileData.avatar_url || null,
      bio: profileData.bio || null,
      created_at: profileData.created_at || null,
      cached_at: new Date().toISOString(),
      pending_sync: options?.pendingSync ?? false
    });
  }

  async getUserProfile(userId: string): Promise<LocalProfile | undefined> {
    return await this.profiles.get(userId);
  }
}

export const localDB = new OfflineChatDatabase();