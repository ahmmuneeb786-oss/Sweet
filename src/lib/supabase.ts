import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          bio: string;
          avatar_url: string | null;
          last_seen: string;
          is_online: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      chats: {
        Row: {
          id: string;
          type: 'direct' | 'group';
          name: string | null;
          avatar_url: string | null;
          description: string | null;
          created_by: string | null;
          theme: 'love' | 'best_friend' | 'friend' | 'default';
          wallpaper: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      messages: {
        Row: {
          id: string;
          chat_id: string;
          sender_id: string;
          content: string | null;
          type: 'text' | 'image' | 'video' | 'voice' | 'video_note' | 'file' | 'gif';
          media_url: string | null;
          media_thumbnail: string | null;
          file_name: string | null;
          file_size: number | null;
          reply_to_id: string | null;
          is_edited: boolean;
          is_deleted: boolean;
          deleted_for_everyone: boolean;
          is_starred: boolean;
          is_pinned: boolean;
          disappear_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
};
