/*
  Part 1 of the remaining security hardening. Safe with the app as currently
  deployed (old clients keep working; see notes per section).

    1. Functions   : nobody can call the account-deleting cleanup job or the
                     unused get_or_create_shared_chat; helper functions get a
                     fixed search_path and are no longer callable signed-out.
    2. Chats       : participants of chats whose id doesn't encode its members
                     can only add themselves (no dragging strangers into chats).
    3. Friend reqs : requests can only be created as 'pending', and nobody can
                     rewrite who a request is between (which let you force a
                     friendship with anyone).
    4. Profiles    : signed-out visitors can no longer read every profile;
                     username availability goes through a yes/no function.
    5. Push subs   : push_subscription moves to an owner-only table. Old app
                     versions still write it to profiles — a trigger moves it.
    6. Visits      : RLS turned on; no one can read or rewrite other visits.
                     Start/heartbeat/login go through small functions.
    7. Storage     : no more listing of other people's files; only the uploader
                     can overwrite/delete a file. (Buckets go private in part 2.)
*/

BEGIN;

-- ── 1. Functions ─────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.cleanup_unconfirmed_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_shared_chat(uuid, uuid) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.get_or_create_shared_chat(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.hook_restrict_signup(jsonb) SET search_path = public;

-- Used only inside RLS policies for signed-in users.
REVOKE EXECUTE ON FUNCTION public.is_chat_member(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_message(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_chat_member(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_see_message(text) TO authenticated;

ALTER FUNCTION public.chats_set_creator() SET search_path = public;
ALTER FUNCTION public.guard_participant_update() SET search_path = public;
ALTER FUNCTION public.guard_message_update() SET search_path = public;

-- ── 2. Chat ids that don't encode members: only add yourself ─────────────

CREATE OR REPLACE FUNCTION public.chat_id_allows_user(p_chat_id text, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_chat_id LIKE 'self-%' THEN p_chat_id = 'self-' || p_user::text
    WHEN p_chat_id ~ '^[0-9a-f-]{36}_[0-9a-f-]{36}$'
      THEN p_user::text IN (split_part(p_chat_id, '_', 1), split_part(p_chat_id, '_', 2))
    ELSE p_user = auth.uid()
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_id_allows_user(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.chat_id_allows_user(text, uuid) TO authenticated;

-- ── 3. Friend requests ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can send requests" ON friend_requests;
CREATE POLICY "Users can send requests" ON friend_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND sender_id <> receiver_id AND status = 'pending');

CREATE OR REPLACE FUNCTION public.guard_friend_request_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN
    RAISE EXCEPTION 'friend_requests: sender and receiver cannot be changed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_friend_request_update ON friend_requests;
CREATE TRIGGER guard_friend_request_update BEFORE UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_friend_request_update();

-- ── 4. Profiles ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles; -- anon: read all
DROP POLICY IF EXISTS "Strict view" ON profiles; -- redundant with the policy below

-- Signup form (signed out) only needs a yes/no, not other people's rows.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM profiles WHERE username = lower(trim(p_username)));
$$;
REVOKE EXECUTE ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;

-- ── 5. Push subscriptions: owner-only table ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id      uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  subscription text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push: own row" ON public.push_subscriptions;
CREATE POLICY "push: own row" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

INSERT INTO public.push_subscriptions (user_id, subscription)
SELECT id, push_subscription FROM profiles WHERE push_subscription IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = now();

-- Older app versions still write profiles.push_subscription: move it across
-- and never leave it on the (widely readable) profile row.
CREATE OR REPLACE FUNCTION public.profiles_move_push_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.push_subscription IS NOT NULL THEN
    INSERT INTO push_subscriptions (user_id, subscription)
    VALUES (NEW.id, NEW.push_subscription)
    ON CONFLICT (user_id) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = now();
    NEW.push_subscription := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_move_push_subscription() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_move_push_subscription ON profiles;
CREATE TRIGGER profiles_move_push_subscription BEFORE INSERT OR UPDATE OF push_subscription ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_move_push_subscription();

UPDATE profiles SET push_subscription = NULL WHERE push_subscription IS NOT NULL;

-- ── 6. Visits ────────────────────────────────────────────────────────────

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon can update own visit" ON visits;   -- was USING (true): anyone could rewrite any visit
DROP POLICY IF EXISTS "Allow anonymous inserts" ON visits;     -- duplicate of the one below
-- "anon can insert visits" (insert only, no read) is kept for the simple tracker.

CREATE OR REPLACE FUNCTION public.start_visit(
  p_visitor_id text, p_has_logged_in_before boolean, p_entry_path text, p_referrer text, p_user_agent text
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO visits (session_id, visitor_id, has_logged_in_before, was_authenticated, entry_path, referrer, user_agent)
  VALUES (left(p_visitor_id, 100), left(p_visitor_id, 100), p_has_logged_in_before, false,
          left(p_entry_path, 500), left(p_referrer, 1000), left(p_user_agent, 500))
  RETURNING id;
$$;

CREATE OR REPLACE FUNCTION public.touch_visit(p_visit_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE visits SET last_seen_at = now()
  WHERE id = p_visit_id AND created_at > now() - interval '1 day';
$$;

CREATE OR REPLACE FUNCTION public.link_visit_to_user(p_visit_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE visits SET user_id = auth.uid(), was_authenticated = true
  WHERE id = p_visit_id AND auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
    AND created_at > now() - interval '1 day';
$$;

REVOKE EXECUTE ON FUNCTION public.start_visit(text, boolean, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_visit(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_visit_to_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_visit(text, boolean, text, text, text) TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.touch_visit(uuid) TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.link_visit_to_user(uuid) TO authenticated;

-- ── 7. Storage: no listing, only the uploader can change/delete ──────────
-- Public-bucket download links keep working (they don't go through these
-- policies). Part 2 makes the chat buckets private.

DROP POLICY IF EXISTS "Voice Note Access" ON storage.objects;               -- ALL for any signed-in user
DROP POLICY IF EXISTS "Allow Public View ph6blb_0" ON storage.objects;      -- anyone could list chat-media
DROP POLICY IF EXISTS "Allow public read access q0sm8g_0" ON storage.objects; -- anyone could list chat-docs
DROP POLICY IF EXISTS "Allow uploads 1oj01fe_0" ON storage.objects;         -- any user could list avatars
DROP POLICY IF EXISTS "Allow uploads 1oj01fe_2" ON storage.objects;         -- any user could overwrite avatars
DROP POLICY IF EXISTS "Allow uploads 1oj01fe_1" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads q0sm8g_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow Authenticated Uploads ph6blb_0" ON storage.objects;

CREATE POLICY "sweet: upload to app buckets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('avatars', 'chat-media', 'chat-docs', 'voice-notes'));

CREATE POLICY "sweet: read own uploads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('avatars', 'chat-media', 'chat-docs', 'voice-notes') AND owner_id = auth.uid()::text);

CREATE POLICY "sweet: update own uploads" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('avatars', 'chat-media', 'chat-docs', 'voice-notes') AND owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

CREATE POLICY "sweet: delete own uploads" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('avatars', 'chat-media', 'chat-docs', 'voice-notes') AND owner_id = auth.uid()::text);

COMMIT;
