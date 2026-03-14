/*
  # Sweet Messaging App Schema - Part 1: Tables

  ## Overview
  Create all tables for Sweet messaging app

  ## Tables Created
  - profiles: User profiles with username, display name, bio
  - privacy_settings: User privacy preferences
  - blocked_users: User blocking relationships
  - friend_requests: Friend request management
  - friends: Established friendships
  - chats: Chat conversations (1-to-1 and groups)
  - chat_participants: Users in each chat
  - messages: Chat messages with media support
  - message_reactions: Emoji reactions on messages
  - locked_chats: Password-protected chats
  - typing_indicators: Real-time typing status

  ## Security
  - RLS enabled on all tables (policies added in next migration)
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL,
  bio text DEFAULT '',
  avatar_url text,
  last_seen timestamptz DEFAULT now(),
  is_online boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_-]+$'),
  CONSTRAINT bio_length CHECK (char_length(bio) <= 250)
);

-- Privacy settings table
CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_visibility text DEFAULT 'everyone',
  profile_photo_visibility text DEFAULT 'everyone',
  who_can_add text DEFAULT 'everyone',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT visibility_options CHECK (
    last_seen_visibility IN ('everyone', 'friends', 'nobody') AND
    profile_photo_visibility IN ('everyone', 'friends', 'nobody') AND
    who_can_add IN ('everyone', 'friends', 'nobody')
  )
);

-- Blocked users table
CREATE TABLE IF NOT EXISTS blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

-- Friend requests table
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT status_options CHECK (status IN ('pending', 'accepted', 'rejected')),
  UNIQUE(sender_id, receiver_id)
);

-- Friends table
CREATE TABLE IF NOT EXISTS friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  name text,
  avatar_url text,
  description text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  theme text DEFAULT 'default',
  wallpaper text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT type_options CHECK (type IN ('direct', 'group')),
  CONSTRAINT theme_options CHECK (theme IN ('love', 'best_friend', 'friend', 'default'))
);

-- Chat participants table
CREATE TABLE IF NOT EXISTS chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  is_muted boolean DEFAULT false,
  muted_until timestamptz,
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT role_options CHECK (role IN ('member', 'admin'))
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  content text,
  type text DEFAULT 'text',
  media_url text,
  media_thumbnail text,
  file_name text,
  file_size bigint,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  is_edited boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  deleted_for_everyone boolean DEFAULT false,
  is_starred boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  disappear_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT type_options CHECK (type IN ('text', 'image', 'video', 'voice', 'video_note', 'file', 'gif'))
);

-- Message reactions table
CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, reaction)
);

-- Locked chats table
CREATE TABLE IF NOT EXISTS locked_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  lock_type text NOT NULL,
  lock_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT lock_type_options CHECK (lock_type IN ('password', 'pin', 'face')),
  UNIQUE(user_id, chat_id)
);

-- Typing indicators table
CREATE TABLE IF NOT EXISTS typing_indicators (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_is_online ON profiles(is_online);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_locked_chats_user ON locked_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_typing_indicators_chat ON typing_indicators(chat_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_privacy_settings_updated_at ON privacy_settings;
CREATE TRIGGER update_privacy_settings_updated_at BEFORE UPDATE ON privacy_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_friend_requests_updated_at ON friend_requests;
CREATE TRIGGER update_friend_requests_updated_at BEFORE UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON chats;
CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();