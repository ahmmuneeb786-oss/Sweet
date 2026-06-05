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
}

class OfflineChatDatabase extends Dexie {
  chats!: Table<LocalChat>;
  messages!: Table<any, string>;
  profiles!: Table<LocalProfile, string>; // Added profiles table

  constructor() {
    super('WhatsAppOfflineDB');
    this.version(2).stores({ 
      chats: 'id, type',
      messages: 'id, chat_id, created_at',
      profiles: 'id, username' 
    });
  }

  // 🌸 Fixed Type Mismatch: Made parameters accept 'any' to accommodate dynamic form payloads smoothly
  async saveUserProfile(userId: string, profileData: any) {
    return await this.profiles.put({
      id: userId,
      username: profileData.username || '',
      display_name: profileData.display_name || '',
      avatar_url: profileData.avatar_url || null,
      bio: profileData.bio || null,
      created_at: profileData.created_at || null,
      cached_at: new Date().toISOString()
    });
  }

  async getUserProfile(userId: string): Promise<LocalProfile | undefined> {
    return await this.profiles.get(userId);
  }
}

export const localDB = new OfflineChatDatabase();