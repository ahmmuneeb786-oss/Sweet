/*
  # Repair migration — re-apply the full base schema safely

  ## Why this exists
  Signup started failing with "Could not find the table 'public.privacy_settings'
  in the schema cache" — the live database is missing at least that one table
  from the original schema migration, even though `profiles`, `chats`,
  `messages`, etc. are clearly present and working. Rather than patch just
  `privacy_settings` and risk hitting the same issue again for some other
  table next time, this re-applies the ENTIRE base schema + RLS policy set
  from the two original migrations, made fully idempotent:

  - `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — already
    safe to re-run, no-ops for anything that already exists.
  - Every `CREATE POLICY` below is preceded by a matching
    `DROP POLICY IF EXISTS`, since policies (unlike tables) error on a
    duplicate name — this is what makes it safe to re-run against tables
    whose policies already exist correctly (profiles, chats, messages, etc.)
    without touching their behavior.

  Net effect: whatever is missing gets created; everything that already
  exists is left untouched.
*/

-- ── Tables ──────────────────────────────────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

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

CREATE TABLE IF NOT EXISTS friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

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

CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, reaction)
);

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

CREATE TABLE IF NOT EXISTS typing_indicators (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
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

-- ── updated_at trigger function + triggers ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE locked_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "Users can view profiles" ON profiles;
CREATE POLICY "Users can view profiles" ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Privacy settings policies
DROP POLICY IF EXISTS "Users can view own privacy settings" ON privacy_settings;
CREATE POLICY "Users can view own privacy settings" ON privacy_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own privacy settings" ON privacy_settings;
CREATE POLICY "Users can update own privacy settings" ON privacy_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own privacy settings" ON privacy_settings;
CREATE POLICY "Users can insert own privacy settings" ON privacy_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Blocked users policies
DROP POLICY IF EXISTS "Users can view own blocks" ON blocked_users;
CREATE POLICY "Users can view own blocks" ON blocked_users FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can insert own blocks" ON blocked_users;
CREATE POLICY "Users can insert own blocks" ON blocked_users FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can delete own blocks" ON blocked_users;
CREATE POLICY "Users can delete own blocks" ON blocked_users FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- Friend requests policies
DROP POLICY IF EXISTS "Users can view friend requests involving them" ON friend_requests;
CREATE POLICY "Users can view friend requests involving them" ON friend_requests FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can send friend requests" ON friend_requests;
CREATE POLICY "Users can send friend requests" ON friend_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can update friend requests they received" ON friend_requests;
CREATE POLICY "Users can update friend requests they received" ON friend_requests FOR UPDATE TO authenticated
  USING (auth.uid() = receiver_id) WITH CHECK (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can delete friend requests they sent" ON friend_requests;
CREATE POLICY "Users can delete friend requests they sent" ON friend_requests FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- Friends policies
DROP POLICY IF EXISTS "Users can view own friendships" ON friends;
CREATE POLICY "Users can view own friendships" ON friends FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own friendships" ON friends;
CREATE POLICY "Users can insert own friendships" ON friends FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own friendships" ON friends;
CREATE POLICY "Users can delete own friendships" ON friends FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Chats policies
DROP POLICY IF EXISTS "Users can view chats they participate in" ON chats;
CREATE POLICY "Users can view chats they participate in" ON chats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can create chats" ON chats;
CREATE POLICY "Users can create chats" ON chats FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Chat participants can update chats" ON chats;
CREATE POLICY "Chat participants can update chats" ON chats FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

-- Chat participants policies
DROP POLICY IF EXISTS "Users can view participants in their chats" ON chat_participants;
CREATE POLICY "Users can view participants in their chats" ON chat_participants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = chat_participants.chat_id
      AND cp.user_id = auth.uid()
      AND cp.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can add participants" ON chat_participants;
CREATE POLICY "Users can add participants" ON chat_participants FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own participant settings" ON chat_participants;
CREATE POLICY "Users can update own participant settings" ON chat_participants FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Messages policies
DROP POLICY IF EXISTS "Users can view messages in their chats" ON messages;
CREATE POLICY "Users can view messages in their chats" ON messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can send messages to their chats" ON messages;
CREATE POLICY "Users can send messages to their chats" ON messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can update own messages" ON messages;
CREATE POLICY "Users can update own messages" ON messages FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can delete own messages" ON messages;
CREATE POLICY "Users can delete own messages" ON messages FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- Message reactions policies
DROP POLICY IF EXISTS "Users can view reactions in their chats" ON message_reactions;
CREATE POLICY "Users can view reactions in their chats" ON message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages
      JOIN chat_participants ON chat_participants.chat_id = messages.chat_id
      WHERE messages.id = message_reactions.message_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can add reactions to messages in their chats" ON message_reactions;
CREATE POLICY "Users can add reactions to messages in their chats" ON message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM messages
      JOIN chat_participants ON chat_participants.chat_id = messages.chat_id
      WHERE messages.id = message_reactions.message_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can delete own reactions" ON message_reactions;
CREATE POLICY "Users can delete own reactions" ON message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Locked chats policies
DROP POLICY IF EXISTS "Users can view own locked chats" ON locked_chats;
CREATE POLICY "Users can view own locked chats" ON locked_chats FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can lock own chats" ON locked_chats;
CREATE POLICY "Users can lock own chats" ON locked_chats FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own locked chats" ON locked_chats;
CREATE POLICY "Users can update own locked chats" ON locked_chats FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own locked chats" ON locked_chats;
CREATE POLICY "Users can delete own locked chats" ON locked_chats FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Typing indicators policies
DROP POLICY IF EXISTS "Users can view typing indicators in their chats" ON typing_indicators;
CREATE POLICY "Users can view typing indicators in their chats" ON typing_indicators FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = typing_indicators.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can set typing indicators in their chats" ON typing_indicators;
CREATE POLICY "Users can set typing indicators in their chats" ON typing_indicators FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = typing_indicators.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can update own typing indicators" ON typing_indicators;
CREATE POLICY "Users can update own typing indicators" ON typing_indicators FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own typing indicators" ON typing_indicators;
CREATE POLICY "Users can delete own typing indicators" ON typing_indicators FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
