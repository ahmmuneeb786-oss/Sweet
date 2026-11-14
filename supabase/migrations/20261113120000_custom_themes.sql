/*
  # Custom themes

  Users build their own themes; they follow the account to every device.

  1. Validation helpers   is_valid_theme_data(), is_valid_chat_theme()
  2. user_themes          themes a user created (max 20 each)
  3. user_theme_settings  which app theme is active (a preset id or a user_themes id)
  4. chat_theme_overrides "Just me" — one user's own theme for one chat
  5. chats.shared_theme   "Both of us" — the chat's theme for everyone in it
  6. set_shared_chat_theme()  changes 5 AND posts a 'theme_change' message
                              in one transaction (that message is the
                              notification the other person gets)
  7. RLS, grants, realtime

  Theme JSON (what the app stores; colours are #RRGGBB):
    theme data:  { "simple": { "bg", "card", "ink", "accent" }, "overrides": { <token>: <hex>, ... } }
    chat theme:  { "kind": "preset", "id": "love" | "best_friend" | "friend" }
              |  { "kind": "custom", "id"?: <uuid>, "name": <text>, "data": <theme data> }
  A custom chat theme carries a COPY of the colours, so the other person sees
  it without owning the theme, and later edits/deletes don't change it.

  Safe to run more than once.
*/


-- =====================================================================
-- 1. Validation helpers
--    Both always return true/false, never NULL: a missing key makes the
--    comparisons NULL, and CHECK / IF NOT treat NULL as "passes".
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_valid_theme_data(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    p IS NOT NULL
    AND jsonb_typeof(p) = 'object'
    AND octet_length(p::text) <= 4096
    AND jsonb_typeof(p -> 'simple') = 'object'
    AND (p -> 'simple' ->> 'bg')     ~ '^#[0-9A-Fa-f]{6}$'
    AND (p -> 'simple' ->> 'card')   ~ '^#[0-9A-Fa-f]{6}$'
    AND (p -> 'simple' ->> 'ink')    ~ '^#[0-9A-Fa-f]{6}$'
    AND (p -> 'simple' ->> 'accent') ~ '^#[0-9A-Fa-f]{6}$'
    AND (
      p -> 'overrides' IS NULL
      OR (
        jsonb_typeof(p -> 'overrides') = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(p -> 'overrides') o
          WHERE o.key !~ '^[a-zA-Z]{1,24}$'
             OR jsonb_typeof(o.value) <> 'string'
             OR (o.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$'
        )
      )
    ),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_valid_chat_theme(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    p IS NOT NULL
    AND jsonb_typeof(p) = 'object'
    AND CASE p ->> 'kind'
      WHEN 'preset' THEN (p ->> 'id') = ANY (ARRAY['love', 'best_friend', 'friend'])
      WHEN 'custom' THEN
        char_length(btrim(coalesce(p ->> 'name', ''))) BETWEEN 1 AND 30
        AND (p -> 'id' IS NULL OR (p ->> 'id') ~ '^[0-9a-fA-F-]{36}$')
        AND public.is_valid_theme_data(p -> 'data')
      ELSE false
    END,
    false);
$function$;


-- =====================================================================
-- 2. user_themes
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.user_themes (
  -- Generated on the device, so a theme made offline keeps its id.
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  data       jsonb NOT NULL CHECK (public.is_valid_theme_data(data)),
  based_on   text CHECK (based_on IS NULL OR char_length(based_on) <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_themes_user_id_idx ON public.user_themes (user_id);

-- At most 20 themes per user. BEFORE INSERT also fires for an upsert that
-- turns into an update (editing a saved theme), so let existing ids through.
CREATE OR REPLACE FUNCTION public.user_themes_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM user_themes WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM user_themes WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'user_themes: limit of 20 themes reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS user_themes_limit ON public.user_themes;
CREATE TRIGGER user_themes_limit
  BEFORE INSERT ON public.user_themes
  FOR EACH ROW EXECUTE FUNCTION public.user_themes_limit();


-- =====================================================================
-- 3. user_theme_settings
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.user_theme_settings (
  user_id     uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  active_kind text NOT NULL DEFAULT 'preset' CHECK (active_kind = ANY (ARRAY['preset', 'custom'])),
  -- preset id (e.g. 'sweet') or a user_themes id. Not a foreign key: a
  -- deleted theme just falls back to the default preset in the app.
  active_ref  text NOT NULL DEFAULT 'sweet' CHECK (char_length(active_ref) BETWEEN 1 AND 40),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
-- 4. chat_theme_overrides  ("Just me")
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.chat_theme_overrides (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id    text NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  theme      jsonb NOT NULL CHECK (public.is_valid_chat_theme(theme)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id)
);


-- =====================================================================
-- 5. chats.shared_theme  ("Both of us")
--    The old chats.theme column is left alone (mixed legacy values).
-- =====================================================================
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS shared_theme    jsonb;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS shared_theme_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS shared_theme_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_shared_theme_valid') THEN
    ALTER TABLE public.chats ADD CONSTRAINT chats_shared_theme_valid
      CHECK (shared_theme IS NULL OR public.is_valid_chat_theme(shared_theme));
  END IF;
END $$;


-- =====================================================================
-- 6. set_shared_chat_theme()
--    p_theme NULL = back to default. Returns the theme_change message id.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_shared_chat_theme(p_chat_id text, p_theme jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_label text;
  v_msg   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_chat_member(p_chat_id) THEN
    RAISE EXCEPTION 'not a member of this chat' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_theme IS NOT NULL AND NOT public.is_valid_chat_theme(p_theme) THEN
    RAISE EXCEPTION 'invalid chat theme' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE chats
     SET shared_theme    = p_theme,
         shared_theme_by = v_uid,
         shared_theme_at = now(),
         updated_at      = now()
   WHERE id = p_chat_id;

  -- What the notification and the in-chat note say.
  v_label := CASE
    WHEN p_theme IS NULL THEN 'Default'
    WHEN p_theme ->> 'kind' = 'preset' THEN CASE p_theme ->> 'id'
      WHEN 'love'        THEN '💕 Love'
      WHEN 'best_friend' THEN '💖 Best Friend'
      WHEN 'friend'      THEN '🌸 Friend'
    END
    ELSE '🎨 ' || btrim(p_theme ->> 'name')
  END;

  INSERT INTO messages (chat_id, sender_id, type, content, status, delivery_status)
  VALUES (p_chat_id, v_uid, 'theme_change', v_label, 'sent', 'sent')
  RETURNING id INTO v_msg;

  RETURN v_msg;
END $function$;


-- =====================================================================
-- 7. RLS, grants, realtime
-- =====================================================================
ALTER TABLE public.user_themes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_theme_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_theme_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_themes: own rows" ON public.user_themes;
CREATE POLICY "user_themes: own rows" ON public.user_themes
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_theme_settings: own row" ON public.user_theme_settings;
CREATE POLICY "user_theme_settings: own row" ON public.user_theme_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Read/delete your own; write only for chats you are in.
DROP POLICY IF EXISTS "chat_theme_overrides: view own" ON public.chat_theme_overrides;
CREATE POLICY "chat_theme_overrides: view own" ON public.chat_theme_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "chat_theme_overrides: delete own" ON public.chat_theme_overrides;
CREATE POLICY "chat_theme_overrides: delete own" ON public.chat_theme_overrides
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "chat_theme_overrides: add for own chats" ON public.chat_theme_overrides;
CREATE POLICY "chat_theme_overrides: add for own chats" ON public.chat_theme_overrides
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_chat_member(chat_id));

DROP POLICY IF EXISTS "chat_theme_overrides: update for own chats" ON public.chat_theme_overrides;
CREATE POLICY "chat_theme_overrides: update for own chats" ON public.chat_theme_overrides
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_chat_member(chat_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_themes          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_theme_settings  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_theme_overrides TO authenticated;

REVOKE ALL ON FUNCTION public.set_shared_chat_theme(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shared_chat_theme(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_themes_limit() FROM PUBLIC, anon, authenticated;

-- Live sync between the user's own devices.
ALTER TABLE public.user_themes          REPLICA IDENTITY FULL;
ALTER TABLE public.user_theme_settings  REPLICA IDENTITY FULL;
ALTER TABLE public.chat_theme_overrides REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_themes', 'user_theme_settings', 'chat_theme_overrides']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
