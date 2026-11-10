/*
  # Sweet - baseline schema

  Generated on 2026-11-10 by reading the LIVE database (project ptezdlwwnjrsqomsspgi)
  through the Postgres catalogs. It replaces every earlier migration file.

  It reproduces exactly what production has today:
    - extensions, enum type, 15 tables (columns, defaults, keys, checks, indexes)
    - 18 functions with their EXECUTE grants
    - 6 triggers
    - row level security + every policy (public and storage)
    - storage buckets, realtime publication, replica identity
    - pg_cron cleanup job and the signup email-domain allowlist

  NOT stored in SQL (configure these by hand on a new project):
    - Vault secret `push_webhook_secret` (value must match the edge function's PUSH_WEBHOOK_SECRET):
        select vault.create_secret('<secret>', 'push_webhook_secret');
    - Auth hook: Dashboard > Authentication > Hooks > "Before User Created" -> public.hook_restrict_signup
    - The project URL is hard-coded in can_read_chat_file() and notify_push_on_message().
*/


-- =====================================================================
-- 1. Extensions
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron     WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


-- =====================================================================
-- 2. Types
-- =====================================================================
DO $$ BEGIN
  CREATE TYPE public.signup_email_domain_type AS ENUM ('allow', 'deny');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =====================================================================
-- 3. Tables
-- =====================================================================

-- profiles (note: id has no FK to auth.users in production)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid PRIMARY KEY,
  username          text UNIQUE,
  display_name      text,
  avatar_url        text,
  is_online         boolean DEFAULT false,
  last_seen         timestamptz NOT NULL DEFAULT now(),
  bio               text,
  push_subscription text,          -- write-only: trigger moves it to push_subscriptions
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.privacy_settings (
  user_id                  uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen_visibility     text DEFAULT 'everyone',
  profile_photo_visibility text DEFAULT 'everyone',
  who_can_add              text DEFAULT 'everyone',
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  CONSTRAINT visibility_options CHECK (
        last_seen_visibility     = ANY (ARRAY['everyone', 'friends', 'nobody'])
    AND profile_photo_visibility = ANY (ARRAY['everyone', 'friends', 'nobody'])
    AND who_can_add              = ANY (ARRAY['everyone', 'friends', 'nobody'])
  )
);

CREATE TABLE IF NOT EXISTS public.profile_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url        text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  sender_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      text DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT friend_requests_sender_id_receiver_id_key UNIQUE (sender_id, receiver_id),
  CONSTRAINT friend_requests_status_check CHECK (status = ANY (ARRAY['pending', 'accepted', 'rejected']))
);

CREATE TABLE IF NOT EXISTS public.friends (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT friends_user_id_friend_id_key UNIQUE (user_id, friend_id)
);

-- chats.id is text: 'self-<uid>' for self chats, '<uid>_<uid>' for direct chats, uuid text otherwise
CREATE TABLE IF NOT EXISTS public.chats (
  id           text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  type         text,
  name         text,
  theme        text DEFAULT 'love',
  created_at   timestamptz DEFAULT now(),
  last_message text,
  updated_at   timestamptz DEFAULT now(),
  avatar_url   text,
  description  text,
  created_by   uuid,
  wallpaper    text
);

CREATE TABLE IF NOT EXISTS public.chat_participants (
  chat_id     text NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  left_at     timestamptz,
  is_locked   boolean DEFAULT false,
  is_muted    boolean NOT NULL DEFAULT false,
  role        text DEFAULT 'member',
  muted_until timestamptz,
  joined_at   timestamptz DEFAULT now(),
  CONSTRAINT chat_participants_pkey PRIMARY KEY (chat_id, user_id),
  -- redundant with the primary key, but present in production
  CONSTRAINT chat_participants_chat_user_key UNIQUE (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id                   text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  chat_id              text REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  content              text,
  created_at           timestamptz DEFAULT now(),
  -- NOTE: production default is the literal string 'text' WITH the quotes
  -- (written as '''text'''). The app always sets `type`, so it never fires.
  type                 text NOT NULL DEFAULT '''text''',
  status               text DEFAULT 'sent',
  delivery_status      text DEFAULT 'sent',
  media_url            text,
  is_deleted           boolean NOT NULL DEFAULT false,
  media_thumbnail      text,
  file_name            text,
  file_size            bigint,
  is_edited            boolean DEFAULT false,
  deleted_for_everyone boolean DEFAULT false,
  is_starred           boolean DEFAULT false,
  is_pinned            boolean DEFAULT false,
  disappear_at         timestamptz,
  updated_at           timestamptz DEFAULT now(),
  reply_to_id          text
);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT message_reactions_message_id_user_id_reaction_key UNIQUE (message_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS public.vault_settings (
  user_id                    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_security_type         text NOT NULL DEFAULT 'none',
  chat_biometric_type        text,
  pin_hash                   text,
  pin_salt                   text,
  password_hash              text,
  password_salt              text,
  face_descriptor            jsonb,
  face_lock_enabled          boolean NOT NULL DEFAULT false,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  fingerprint_credential_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_other_methods        boolean NOT NULL DEFAULT false,
  app_lock_face              boolean NOT NULL DEFAULT false,
  app_lock_fingerprint       boolean NOT NULL DEFAULT false,
  app_password_hash          text,
  app_password_salt          text,
  CONSTRAINT vault_settings_chat_security_type_check
    CHECK (chat_security_type = ANY (ARRAY['none', 'pin', 'password', 'face', 'fingerprint'])),
  CONSTRAINT vault_settings_chat_biometric_type_check
    CHECK (chat_biometric_type = ANY (ARRAY['face', 'fingerprint']))
);

CREATE TABLE IF NOT EXISTS public.visits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  session_id           text NOT NULL,
  visitor_id           text,
  user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  has_logged_in_before boolean NOT NULL DEFAULT false,
  was_authenticated    boolean NOT NULL DEFAULT false,
  entry_path           text,
  referrer             text,
  user_agent           text,
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  status               text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.visit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id   uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signup_email_domains (
  id         serial PRIMARY KEY,
  domain     text NOT NULL UNIQUE,
  type       public.signup_email_domain_type NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signup_block_attempts (
  id         bigserial PRIMARY KEY,
  ip_address text NOT NULL,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
-- 4. Indexes (beyond primary keys / unique constraints)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_messages_status               ON public.messages (chat_id, delivery_status);
CREATE INDEX IF NOT EXISTS messages_media_url_idx            ON public.messages (media_url) WHERE media_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profile_photos_user           ON public.profile_photos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_block_attempts_ip_time ON public.signup_block_attempts (ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_visit_events_visit_id         ON public.visit_events (visit_id);
CREATE INDEX IF NOT EXISTS idx_visits_visitor_id             ON public.visits (visitor_id);


-- =====================================================================
-- 5. Replica identity (full rows in realtime UPDATE/DELETE payloads)
-- =====================================================================
ALTER TABLE public.chats    REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;


-- =====================================================================
-- 6. Functions
-- =====================================================================

-- ---- RLS helpers --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_chat_member(p_chat_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid() AND left_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_see_message(p_message_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_participants p ON p.chat_id = m.chat_id
    WHERE m.id = p_message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.chat_id_allows_user(p_chat_id text, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_chat_id LIKE 'self-%' THEN p_chat_id = 'self-' || p_user::text
    WHEN p_chat_id ~ '^[0-9a-f-]{36}_[0-9a-f-]{36}$'
      THEN p_user::text IN (split_part(p_chat_id, '_', 1), split_part(p_chat_id, '_', 2))
    ELSE p_user = auth.uid()
  END;
$function$;

CREATE OR REPLACE FUNCTION public.can_read_chat_file(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM messages m
    JOIN chat_participants p ON p.chat_id = m.chat_id
    WHERE m.media_url = 'https://ptezdlwwnjrsqomsspgi.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_name
      AND m.is_deleted IS NOT TRUE
      AND p.user_id = auth.uid()
      AND p.left_at IS NULL
  );
$function$;

-- ---- Trigger functions --------------------------------------------------
CREATE OR REPLACE FUNCTION public.chats_set_creator()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_friend_request_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN
    RAISE EXCEPTION 'friend_requests: sender and receiver cannot be changed';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_message_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.guard_participant_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'chat_participants: chat_id, user_id, role and joined_at cannot be changed';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.profiles_move_push_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.push_subscription IS NOT NULL THEN
    INSERT INTO push_subscriptions (user_id, subscription)
    VALUES (NEW.id, NEW.push_subscription)
    ON CONFLICT (user_id) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = now();
    NEW.push_subscription := NULL;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_push_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://ptezdlwwnjrsqomsspgi.supabase.co/functions/v1/send-sweet-push',
    body := jsonb_build_object('message_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- never let a push problem stop a message from being sent
END $function$;

-- ---- Client RPCs --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM profiles WHERE username = lower(trim(p_username)));
$function$;

CREATE OR REPLACE FUNCTION public.is_email_registered(check_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(check_email)
  );
$function$;

CREATE OR REPLACE FUNCTION public.start_visit(p_visitor_id text, p_has_logged_in_before boolean, p_entry_path text, p_referrer text, p_user_agent text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO visits (session_id, visitor_id, has_logged_in_before, was_authenticated, entry_path, referrer, user_agent)
  VALUES (left(p_visitor_id, 100), left(p_visitor_id, 100), p_has_logged_in_before, false,
          left(p_entry_path, 500), left(p_referrer, 1000), left(p_user_agent, 500))
  RETURNING id;
$function$;

CREATE OR REPLACE FUNCTION public.touch_visit(p_visit_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE visits SET last_seen_at = now()
  WHERE id = p_visit_id AND created_at > now() - interval '1 day';
$function$;

CREATE OR REPLACE FUNCTION public.link_visit_to_user(p_visit_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE visits SET user_id = auth.uid(), was_authenticated = true
  WHERE id = p_visit_id AND auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
    AND created_at > now() - interval '1 day';
$function$;

-- ---- Server-only --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hook_restrict_signup(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_domain text;
  v_ip text;
  v_is_allowed int;
  v_recent_blocks int;
begin
  v_email := lower(event->'user'->>'email');
  v_domain := split_part(v_email, '@', 2);
  v_ip := event->'metadata'->>'ip_address';

  -- Already locked out from too many recent bad attempts?
  select count(*) into v_recent_blocks
  from public.signup_block_attempts
  where ip_address = v_ip
    and created_at > now() - interval '24 hours';

  if v_recent_blocks >= 3 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Too many signup attempts from this device. Please try again in 24 hours.',
        'http_code', 429
      )
    );
  end if;

  -- Is the domain on the trusted allowlist?
  select count(*) into v_is_allowed
  from public.signup_email_domains
  where type = 'allow' and lower(domain) = v_domain;

  if v_is_allowed > 0 then
    return '{}'::jsonb; -- allowed, proceed
  end if;

  -- Untrusted domain: log it (counts toward this IP's 24h lockout) and reject
  insert into public.signup_block_attempts (ip_address, email) values (v_ip, v_email);

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Dear user, please enter a valid and trusted email',
      'http_code', 400
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_unconfirmed_users()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
begin
  delete from auth.users
  where email_confirmed_at is null
    and created_at < now() - interval '48 hours';
end;
$function$;

-- Legacy: not called by the app; only service_role can execute it.
CREATE OR REPLACE FUNCTION public.get_or_create_shared_chat(user_a uuid, user_b uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    existing_chat_id UUID;
BEGIN
    -- 1. Try to find a chat that BOTH users belong to
    SELECT cp1.chat_id INTO existing_chat_id
    FROM chat_participants cp1
    JOIN chat_participants cp2 ON cp1.chat_id = cp2.chat_id
    WHERE cp1.user_id = user_a AND cp2.user_id = user_b
    LIMIT 1;

    -- 2. If we found one, return it
    IF existing_chat_id IS NOT NULL THEN
        RETURN existing_chat_id;
    END IF;

    -- 3. If not, create a new chat
    INSERT INTO chats (type, name) VALUES ('direct', 'Shared Chat')
    RETURNING id INTO existing_chat_id;

    -- 4. Add both users as participants
    INSERT INTO chat_participants (chat_id, user_id)
    VALUES (existing_chat_id, user_a), (existing_chat_id, user_b);

    RETURN existing_chat_id;
END;
$function$;


-- =====================================================================
-- 7. Function privileges (match production exactly)
--    Supabase auto-grants EXECUTE to anon/authenticated, so revoke first.
-- =====================================================================

-- signed-in users only
REVOKE ALL ON FUNCTION public.is_chat_member(text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_see_message(text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_id_allows_user(text, uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_chat_file(text, text)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_member(text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_message(text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_id_allows_user(text, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_chat_file(text, text)   TO authenticated, service_role;

-- anon + signed-in (no PUBLIC)
REVOKE ALL ON FUNCTION public.is_username_available(text)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_visit(text, boolean, text, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_visit(uuid)                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_visit_to_user(uuid)                            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(text)                      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_visit(text, boolean, text, text, text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_visit(uuid)                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_visit_to_user(uuid)                         TO anon, authenticated, service_role;

-- is_email_registered keeps the default (PUBLIC) grant, as in production;
-- the sign-up page calls it before the user is logged in.
GRANT EXECUTE ON FUNCTION public.is_email_registered(text) TO PUBLIC, anon, authenticated, service_role;

-- server only
REVOKE ALL ON FUNCTION public.notify_push_on_message()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_move_push_subscription()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_unconfirmed_users()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_or_create_shared_chat(uuid, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hook_restrict_signup(jsonb)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_push_on_message()              TO service_role;
GRANT EXECUTE ON FUNCTION public.profiles_move_push_subscription()     TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_unconfirmed_users()           TO service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_shared_chat(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hook_restrict_signup(jsonb)           TO service_role, supabase_auth_admin;

-- chats_set_creator / guard_* trigger functions keep default privileges.


-- =====================================================================
-- 8. Triggers
-- =====================================================================
DROP TRIGGER IF EXISTS chats_set_creator ON public.chats;
CREATE TRIGGER chats_set_creator
  BEFORE INSERT ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.chats_set_creator();

DROP TRIGGER IF EXISTS guard_participant_update ON public.chat_participants;
CREATE TRIGGER guard_participant_update
  BEFORE UPDATE ON public.chat_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_participant_update();

DROP TRIGGER IF EXISTS guard_friend_request_update ON public.friend_requests;
CREATE TRIGGER guard_friend_request_update
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_friend_request_update();

DROP TRIGGER IF EXISTS guard_message_update ON public.messages;
CREATE TRIGGER guard_message_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

DROP TRIGGER IF EXISTS notify_push_on_message ON public.messages;
CREATE TRIGGER notify_push_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_message();

DROP TRIGGER IF EXISTS profiles_move_push_subscription ON public.profiles;
CREATE TRIGGER profiles_move_push_subscription
  BEFORE INSERT OR UPDATE OF push_subscription ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_move_push_subscription();


-- =====================================================================
-- 9. Table privileges
--    Supabase grants anon/authenticated/service_role on new tables by
--    default; production differs only here:
-- =====================================================================
REVOKE ALL ON public.vault_settings FROM anon;


-- =====================================================================
-- 10. Row level security + policies
-- =====================================================================
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_email_domains  ENABLE ROW LEVEL SECURITY;  -- no policies: server only
ALTER TABLE public.signup_block_attempts ENABLE ROW LEVEL SECURITY;  -- no policies: server only

-- ---- profiles -----------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
CREATE POLICY "Enable read access for all users" ON public.profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow users to create their own profile" ON public.profiles;
CREATE POLICY "Allow users to create their own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Strict update" ON public.profiles;
CREATE POLICY "Strict update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ---- privacy_settings ---------------------------------------------------
DROP POLICY IF EXISTS "Users can view own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can view own privacy settings" ON public.privacy_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can insert own privacy settings" ON public.privacy_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can update own privacy settings" ON public.privacy_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---- profile_photos -----------------------------------------------------
DROP POLICY IF EXISTS "Users can view profile photos" ON public.profile_photos;
CREATE POLICY "Users can view profile photos" ON public.profile_photos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert own profile photos" ON public.profile_photos;
CREATE POLICY "Users can insert own profile photos" ON public.profile_photos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own profile photos" ON public.profile_photos;
CREATE POLICY "Users can delete own profile photos" ON public.profile_photos
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---- push_subscriptions -------------------------------------------------
DROP POLICY IF EXISTS "push: own row" ON public.push_subscriptions;
CREATE POLICY "push: own row" ON public.push_subscriptions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---- friend_requests ----------------------------------------------------
DROP POLICY IF EXISTS "Users can see their own requests" ON public.friend_requests;
CREATE POLICY "Users can see their own requests" ON public.friend_requests
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can send requests" ON public.friend_requests;
CREATE POLICY "Users can send requests" ON public.friend_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND sender_id <> receiver_id AND status = 'pending');

DROP POLICY IF EXISTS "Users can accept requests" ON public.friend_requests;
CREATE POLICY "Users can accept requests" ON public.friend_requests
  FOR UPDATE USING (auth.uid() = receiver_id);

-- duplicate of "Users can accept requests", present in production
DROP POLICY IF EXISTS "Users can update requests" ON public.friend_requests;
CREATE POLICY "Users can update requests" ON public.friend_requests
  FOR UPDATE USING (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can delete requests" ON public.friend_requests;
CREATE POLICY "Users can delete requests" ON public.friend_requests
  FOR DELETE USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ---- friends ------------------------------------------------------------
DROP POLICY IF EXISTS "friends: view own" ON public.friends;
CREATE POLICY "friends: view own" ON public.friends
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

DROP POLICY IF EXISTS "friends: add after accepted request" ON public.friends;
CREATE POLICY "friends: add after accepted request" ON public.friends
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = user_id OR auth.uid() = friend_id)
    AND EXISTS (
      SELECT 1 FROM public.friend_requests r
      WHERE r.status = 'accepted'
        AND (   (r.sender_id = friends.user_id   AND r.receiver_id = friends.friend_id)
             OR (r.sender_id = friends.friend_id AND r.receiver_id = friends.user_id))
    )
  );

DROP POLICY IF EXISTS "friends: update own" ON public.friends;
CREATE POLICY "friends: update own" ON public.friends
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = friend_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = friend_id);

DROP POLICY IF EXISTS "friends: remove own" ON public.friends;
CREATE POLICY "friends: remove own" ON public.friends
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ---- chats --------------------------------------------------------------
DROP POLICY IF EXISTS "chats: members and creator can view" ON public.chats;
CREATE POLICY "chats: members and creator can view" ON public.chats
  FOR SELECT TO authenticated USING (public.is_chat_member(id) OR created_by = auth.uid());

DROP POLICY IF EXISTS "chats: create as yourself" ON public.chats;
CREATE POLICY "chats: create as yourself" ON public.chats
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.chat_id_allows_user(id, auth.uid()));

DROP POLICY IF EXISTS "chats: members can update" ON public.chats;
CREATE POLICY "chats: members can update" ON public.chats
  FOR UPDATE TO authenticated USING (public.is_chat_member(id)) WITH CHECK (public.is_chat_member(id));

-- ---- chat_participants --------------------------------------------------
DROP POLICY IF EXISTS "participants: view own and fellow members" ON public.chat_participants;
CREATE POLICY "participants: view own and fellow members" ON public.chat_participants
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_chat_member(chat_id));

DROP POLICY IF EXISTS "participants: creator or member can add" ON public.chat_participants;
CREATE POLICY "participants: creator or member can add" ON public.chat_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.chat_id_allows_user(chat_id, user_id)
    AND (
      EXISTS (SELECT 1 FROM public.chats c
              WHERE c.id = chat_participants.chat_id AND c.created_by = auth.uid())
      OR public.is_chat_member(chat_id)
    )
  );

DROP POLICY IF EXISTS "participants: update own row" ON public.chat_participants;
CREATE POLICY "participants: update own row" ON public.chat_participants
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "participants: leave (delete own row)" ON public.chat_participants;
CREATE POLICY "participants: leave (delete own row)" ON public.chat_participants
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---- messages -----------------------------------------------------------
DROP POLICY IF EXISTS "messages: members can view" ON public.messages;
CREATE POLICY "messages: members can view" ON public.messages
  FOR SELECT TO authenticated USING (public.is_chat_member(chat_id));

DROP POLICY IF EXISTS "messages: members send as themselves" ON public.messages;
CREATE POLICY "messages: members send as themselves" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND public.is_chat_member(chat_id));

DROP POLICY IF EXISTS "messages: members can update (guarded by trigger)" ON public.messages;
CREATE POLICY "messages: members can update (guarded by trigger)" ON public.messages
  FOR UPDATE TO authenticated USING (public.is_chat_member(chat_id)) WITH CHECK (public.is_chat_member(chat_id));

DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;
CREATE POLICY "Users can delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (auth.uid() = sender_id);

-- ---- message_reactions --------------------------------------------------
DROP POLICY IF EXISTS "reactions: members can view" ON public.message_reactions;
CREATE POLICY "reactions: members can view" ON public.message_reactions
  FOR SELECT TO authenticated USING (public.can_see_message(message_id));

DROP POLICY IF EXISTS "reactions: members react as themselves" ON public.message_reactions;
CREATE POLICY "reactions: members react as themselves" ON public.message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.can_see_message(message_id));

DROP POLICY IF EXISTS "reactions: remove own" ON public.message_reactions;
CREATE POLICY "reactions: remove own" ON public.message_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---- vault_settings -----------------------------------------------------
DROP POLICY IF EXISTS "vault owner select" ON public.vault_settings;
CREATE POLICY "vault owner select" ON public.vault_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault owner insert" ON public.vault_settings;
CREATE POLICY "vault owner insert" ON public.vault_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault owner update" ON public.vault_settings;
CREATE POLICY "vault owner update" ON public.vault_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vault owner delete" ON public.vault_settings;
CREATE POLICY "vault owner delete" ON public.vault_settings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---- visits / visit_events (write-only from the client) -----------------
DROP POLICY IF EXISTS "anon can insert visits" ON public.visits;
CREATE POLICY "anon can insert visits" ON public.visits
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon can insert events" ON public.visit_events;
CREATE POLICY "anon can insert events" ON public.visit_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);


-- =====================================================================
-- 11. Storage buckets + policies
-- =====================================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars',       'avatars',       true),
  ('chat-media',    'chat-media',    false),
  ('chat-docs',     'chat-docs',     false),
  ('voice-notes',   'voice-notes',   false),
  ('message-media', 'message-media', false)   -- legacy: not used by the app or any policy
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sweet: upload to app buckets" ON storage.objects;
CREATE POLICY "sweet: upload to app buckets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = ANY (ARRAY['avatars', 'chat-media', 'chat-docs', 'voice-notes']));

DROP POLICY IF EXISTS "sweet: read own uploads" ON storage.objects;
CREATE POLICY "sweet: read own uploads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['avatars', 'chat-media', 'chat-docs', 'voice-notes'])
         AND owner_id = (auth.uid())::text);

DROP POLICY IF EXISTS "sweet: chat members read chat files" ON storage.objects;
CREATE POLICY "sweet: chat members read chat files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['chat-media', 'chat-docs', 'voice-notes'])
         AND public.can_read_chat_file(bucket_id, name));

DROP POLICY IF EXISTS "sweet: update own uploads" ON storage.objects;
CREATE POLICY "sweet: update own uploads" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = ANY (ARRAY['avatars', 'chat-media', 'chat-docs', 'voice-notes'])
         AND owner_id = (auth.uid())::text)
  WITH CHECK (owner_id = (auth.uid())::text);

DROP POLICY IF EXISTS "sweet: delete own uploads" ON storage.objects;
CREATE POLICY "sweet: delete own uploads" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = ANY (ARRAY['avatars', 'chat-media', 'chat-docs', 'voice-notes'])
         AND owner_id = (auth.uid())::text);


-- =====================================================================
-- 12. Realtime publication
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'friend_requests', 'friends', 'chats',
                           'chat_participants', 'messages', 'message_reactions']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- 13. Scheduled jobs
-- =====================================================================
SELECT cron.schedule(
  'cleanup-unconfirmed-signups',
  '0 3 * * *',
  'select public.cleanup_unconfirmed_users();'
);


-- =====================================================================
-- 14. Reference data: sign-up email allowlist (required for sign-up to work)
-- =====================================================================
INSERT INTO public.signup_email_domains (domain, type) VALUES
  ('gmail.com',      'allow'),
  ('googlemail.com', 'allow'),
  ('outlook.com',    'allow'),
  ('hotmail.com',    'allow'),
  ('live.com',       'allow'),
  ('yahoo.com',      'allow'),
  ('icloud.com',     'allow'),
  ('me.com',         'allow'),
  ('proton.me',      'allow'),
  ('protonmail.com', 'allow')
ON CONFLICT (domain) DO NOTHING;
