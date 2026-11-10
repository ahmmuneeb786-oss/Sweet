/*
  Lock down chat data. Before this, `chats` and `chat_participants` had an
  "Allow All" policy for everyone (even signed-out users with the public anon
  key), `messages` was fully readable/writable by any signed-in user,
  `message_reactions` was world-readable and `friends` was "Allow all".

  After this:
    chats              see: members (+ the creator, so insert().select() works)
                       create: as yourself, only ids you belong to
                       update: members      delete: nobody (client never does)
    chat_participants  see: your own rows + rows of chats you're in
                       add: the chat's creator or an existing member, and only
                            people who belong in that id (DM pair / own self chat)
                       update/delete: your own row only (mute, lock, leave)
    messages           see/send: members, sending only as yourself
                       update: members; non-senders may only change
                               delivery_status/status (read receipts)
                       delete: sender only
    message_reactions  see/add: members of the message's chat, add as yourself
                       delete: your own
    friends            see/delete: rows you're on; add: only with an accepted
                       friend request between the two users

  Written against the live schema (text chat/message ids) — checked
  2026-11-10 that all existing rows already satisfy these rules.
*/

BEGIN;

-- ── Helpers (SECURITY DEFINER so policies on chat_participants can check
--    membership without recursing into their own RLS) ─────────────────────

CREATE OR REPLACE FUNCTION public.is_chat_member(p_chat_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid() AND left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.can_see_message(p_message_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_participants p ON p.chat_id = m.chat_id
    WHERE m.id = p_message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
  );
$$;

-- Ids that encode who belongs in them: `self-<uid>` (only that user) and
-- `<uidA>_<uidB>` DMs (only those two). Any other id format is unrestricted.
CREATE OR REPLACE FUNCTION public.chat_id_allows_user(p_chat_id text, p_user uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_chat_id LIKE 'self-%' THEN p_chat_id = 'self-' || p_user::text
    WHEN p_chat_id ~ '^[0-9a-f-]{36}_[0-9a-f-]{36}$'
      THEN p_user::text IN (split_part(p_chat_id, '_', 1), split_part(p_chat_id, '_', 2))
    ELSE true
  END;
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────

-- Older clients create DM chats without created_by; fill it in so the
-- creator can read the row back and add the participants.
CREATE OR REPLACE FUNCTION public.chats_set_creator()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chats_set_creator ON chats;
CREATE TRIGGER chats_set_creator BEFORE INSERT ON chats
  FOR EACH ROW EXECUTE FUNCTION public.chats_set_creator();

-- Participants may only change their own settings, never which chat/user the
-- row is for or their role. (auth.uid() is null for service role / SQL.)
CREATE OR REPLACE FUNCTION public.guard_participant_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'chat_participants: chat_id, user_id, role and joined_at cannot be changed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_participant_update ON chat_participants;
CREATE TRIGGER guard_participant_update BEFORE UPDATE ON chat_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_participant_update();

-- Only the sender may edit/delete a message; other members may only mark it
-- delivered/read. Nobody may move a message or change its author.
CREATE OR REPLACE FUNCTION public.guard_message_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  receipt_cols text[] := ARRAY['delivery_status', 'status', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'messages: id, chat_id, sender_id and created_at cannot be changed';
  END IF;
  IF auth.uid() IS DISTINCT FROM OLD.sender_id
     AND (to_jsonb(NEW) - receipt_cols) IS DISTINCT FROM (to_jsonb(OLD) - receipt_cols) THEN
    RAISE EXCEPTION 'messages: only the sender can change this message';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_message_update ON messages;
CREATE TRIGGER guard_message_update BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

-- ── chats ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow All" ON chats;
DROP POLICY IF EXISTS "Temp bypass for testing" ON chats;

CREATE POLICY "chats: members and creator can view" ON chats
  FOR SELECT TO authenticated
  USING (public.is_chat_member(id) OR created_by = auth.uid());

CREATE POLICY "chats: create as yourself" ON chats
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.chat_id_allows_user(id, auth.uid()));

CREATE POLICY "chats: members can update" ON chats
  FOR UPDATE TO authenticated
  USING (public.is_chat_member(id))
  WITH CHECK (public.is_chat_member(id));

-- ── chat_participants ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow All" ON chat_participants;

CREATE POLICY "participants: view own and fellow members" ON chat_participants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_chat_member(chat_id));

CREATE POLICY "participants: creator or member can add" ON chat_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.chat_id_allows_user(chat_id, user_id)
    AND (
      EXISTS (SELECT 1 FROM chats c WHERE c.id = chat_id AND c.created_by = auth.uid())
      OR public.is_chat_member(chat_id)
    )
  );

CREATE POLICY "participants: update own row" ON chat_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "participants: leave (delete own row)" ON chat_participants
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── messages ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow All" ON messages;
DROP POLICY IF EXISTS "Users can update own messages" ON messages;
-- "Users can delete own messages" (sender only) is kept as is.

CREATE POLICY "messages: members can view" ON messages
  FOR SELECT TO authenticated
  USING (public.is_chat_member(chat_id));

CREATE POLICY "messages: members send as themselves" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_chat_member(chat_id));

CREATE POLICY "messages: members can update (guarded by trigger)" ON messages
  FOR UPDATE TO authenticated
  USING (public.is_chat_member(chat_id))
  WITH CHECK (public.is_chat_member(chat_id));

-- ── message_reactions ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow individual read access" ON message_reactions;
DROP POLICY IF EXISTS "Allow individual insert" ON message_reactions;
DROP POLICY IF EXISTS "Allow individual delete" ON message_reactions;

CREATE POLICY "reactions: members can view" ON message_reactions
  FOR SELECT TO authenticated
  USING (public.can_see_message(message_id));

CREATE POLICY "reactions: members react as themselves" ON message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_see_message(message_id));

CREATE POLICY "reactions: remove own" ON message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── friends ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow all" ON friends;
DROP POLICY IF EXISTS "Users can remove friends" ON friends;
DROP POLICY IF EXISTS "Users can add friends" ON friends;
DROP POLICY IF EXISTS "Users can add to friends list" ON friends;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON friends;
DROP POLICY IF EXISTS "Users can see their own friends" ON friends;
DROP POLICY IF EXISTS "Enable select for users to see their friends" ON friends;
DROP POLICY IF EXISTS "Users can view their own friends" ON friends;

CREATE POLICY "friends: view own" ON friends
  FOR SELECT TO authenticated
  USING (auth.uid() IN (user_id, friend_id));

-- Accepting a request upserts BOTH directions, so either side may write the
-- pair — but only once an accepted request between them exists.
CREATE POLICY "friends: add after accepted request" ON friends
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IN (user_id, friend_id)
    AND EXISTS (
      SELECT 1 FROM friend_requests r
      WHERE r.status = 'accepted'
        AND ((r.sender_id = user_id AND r.receiver_id = friend_id)
          OR (r.sender_id = friend_id AND r.receiver_id = user_id))
    )
  );

-- Needed by the upsert's ON CONFLICT DO UPDATE path.
CREATE POLICY "friends: update own" ON friends
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (user_id, friend_id))
  WITH CHECK (auth.uid() IN (user_id, friend_id));

CREATE POLICY "friends: remove own" ON friends
  FOR DELETE TO authenticated
  USING (auth.uid() IN (user_id, friend_id));

COMMIT;
