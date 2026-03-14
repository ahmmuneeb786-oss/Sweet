/*
  # Sweet Messaging App Schema - Part 2: RLS Policies

  ## Overview
  Add Row Level Security policies to all tables

  ## Security Implementation
  1. Profiles: Users can view all profiles, update own profile
  2. Privacy Settings: Users can only access their own settings
  3. Blocked Users: Users can manage their own blocks
  4. Friend Requests: Users can see requests involving them
  5. Friends: Users can manage their own friendships
  6. Chats: Users can access chats they're participants in
  7. Chat Participants: Proper access control for chat membership
  8. Messages: Users can access messages in their chats
  9. Message Reactions: Users can react to messages in their chats
  10. Locked Chats: Users can only access their own locked chats
  11. Typing Indicators: Real-time typing in user's chats
*/

-- Enable RLS on all tables
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
CREATE POLICY "Users can view profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Privacy settings policies
CREATE POLICY "Users can view own privacy settings"
  ON privacy_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own privacy settings"
  ON privacy_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own privacy settings"
  ON privacy_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Blocked users policies
CREATE POLICY "Users can view own blocks"
  ON blocked_users FOR SELECT
  TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can insert own blocks"
  ON blocked_users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can delete own blocks"
  ON blocked_users FOR DELETE
  TO authenticated
  USING (auth.uid() = blocker_id);

-- Friend requests policies
CREATE POLICY "Users can view friend requests involving them"
  ON friend_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send friend requests"
  ON friend_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update friend requests they received"
  ON friend_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = receiver_id);

CREATE POLICY "Users can delete friend requests they sent"
  ON friend_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

-- Friends policies
CREATE POLICY "Users can view own friendships"
  ON friends FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own friendships"
  ON friends FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own friendships"
  ON friends FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Chats policies
CREATE POLICY "Users can view chats they participate in"
  ON chats FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can create chats"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Chat participants can update chats"
  ON chats FOR UPDATE
  TO authenticated
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
CREATE POLICY "Users can view participants in their chats"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = chat_participants.chat_id
      AND cp.user_id = auth.uid()
      AND cp.left_at IS NULL
    )
  );

CREATE POLICY "Users can add participants"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own participant settings"
  ON chat_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Messages policies
CREATE POLICY "Users can view messages in their chats"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can send messages to their chats"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can update own messages"
  ON messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can delete own messages"
  ON messages FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

-- Message reactions policies
CREATE POLICY "Users can view reactions in their chats"
  ON message_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages
      JOIN chat_participants ON chat_participants.chat_id = messages.chat_id
      WHERE messages.id = message_reactions.message_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can add reactions to messages in their chats"
  ON message_reactions FOR INSERT
  TO authenticated
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

CREATE POLICY "Users can delete own reactions"
  ON message_reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Locked chats policies
CREATE POLICY "Users can view own locked chats"
  ON locked_chats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can lock own chats"
  ON locked_chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own locked chats"
  ON locked_chats FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own locked chats"
  ON locked_chats FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Typing indicators policies
CREATE POLICY "Users can view typing indicators in their chats"
  ON typing_indicators FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = typing_indicators.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can set typing indicators in their chats"
  ON typing_indicators FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = typing_indicators.chat_id
      AND chat_participants.user_id = auth.uid()
      AND chat_participants.left_at IS NULL
    )
  );

CREATE POLICY "Users can update own typing indicators"
  ON typing_indicators FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own typing indicators"
  ON typing_indicators FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);