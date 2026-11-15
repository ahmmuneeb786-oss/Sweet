/*
  # Notification centre ("Sweet Whispers")

  1. push_subscriptions      one row PER DEVICE (was one per user: a second
                             device silently replaced the first)
     register_push_device()  / unregister_push_device()  — the app's only way in
  2. notification_prefs      categories, peek privacy, timezone, Heartbeat Tap
  3. notification_jars       Bedtime Jars: named quiet hours (max 3 per user)
     notification_jar_items  what waited in a jar (count per sender)
  4. Jar helpers             jar_is_active(), active_quiet_jar(), jar_add_item(),
                             claim_due_jar_digests()  — used by the edge function
  5. Friend-request push trigger
  6. Wake-up digest cron job (every 5 minutes, only calls out when a jar is due)
  7. RLS + grants

  The edge function `send-sweet-push` must be redeployed AFTER this runs.
  Until then the old function ignores the new calls (they fail harmlessly).

  Safe to run more than once.
*/


-- =====================================================================
-- 1. push_subscriptions: one row per device
-- =====================================================================
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS id          uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS endpoint    text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS label       text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS last_push_at timestamptz;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS fail_count  integer NOT NULL DEFAULT 0;

-- Old rows: pull the endpoint out of the stored JSON. Rows that aren't valid
-- JSON can't receive pushes anyway, so they are dropped.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT ctid, subscription FROM public.push_subscriptions WHERE endpoint IS NULL LOOP
    BEGIN
      UPDATE public.push_subscriptions
         SET endpoint = r.subscription::jsonb ->> 'endpoint'
       WHERE ctid = r.ctid;
    EXCEPTION WHEN others THEN
      DELETE FROM public.push_subscriptions WHERE ctid = r.ctid;
    END;
  END LOOP;
  DELETE FROM public.push_subscriptions WHERE endpoint IS NULL OR endpoint = '';
END $$;

-- One browser used by two accounts used to be stored twice (one row per
-- user), so that browser got BOTH accounts' notifications. A device belongs
-- to whoever registered it last: keep that row, drop the older ones.
DELETE FROM public.push_subscriptions a
 USING public.push_subscriptions b
 WHERE a.endpoint = b.endpoint
   AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.ctid < b.ctid));

ALTER TABLE public.push_subscriptions ALTER COLUMN endpoint SET NOT NULL;
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_label_len;
ALTER TABLE public.push_subscriptions ADD  CONSTRAINT push_subscriptions_label_len
  CHECK (label IS NULL OR char_length(label) <= 60);

-- Primary key moves from user_id to id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)'
  ) THEN
    ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON public.push_subscriptions (endpoint);
CREATE INDEX        IF NOT EXISTS push_subscriptions_user_idx     ON public.push_subscriptions (user_id);

-- The legacy profiles.push_subscription path used ON CONFLICT (user_id),
-- which no longer exists — point it at the endpoint instead.
CREATE OR REPLACE FUNCTION public.profiles_move_push_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_endpoint text;
BEGIN
  IF NEW.push_subscription IS NOT NULL THEN
    BEGIN
      v_endpoint := NEW.push_subscription::jsonb ->> 'endpoint';
    EXCEPTION WHEN others THEN
      v_endpoint := NULL;
    END;
    IF v_endpoint IS NOT NULL AND v_endpoint <> '' THEN
      INSERT INTO push_subscriptions (user_id, endpoint, subscription)
      VALUES (NEW.id, v_endpoint, NEW.push_subscription)
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription,
            updated_at = now(), fail_count = 0;
    END IF;
    NEW.push_subscription := NULL;
  END IF;
  RETURN NEW;
END $function$;

-- The app registers its device through this, never by writing the table.
-- A browser belongs to whoever is signed in on it NOW: if another account
-- registered this same endpoint before (sign out → sign in as someone else),
-- that row is taken over, so the old account's messages stop arriving here.
CREATE OR REPLACE FUNCTION public.register_push_device(p_subscription jsonb, p_label text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_endpoint text := p_subscription ->> 'endpoint';
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_subscription) <> 'object'
     OR v_endpoint IS NULL OR v_endpoint !~ '^https://' OR char_length(v_endpoint) > 1000
     OR jsonb_typeof(p_subscription -> 'keys') <> 'object'
     OR coalesce(p_subscription -> 'keys' ->> 'p256dh', '') = ''
     OR coalesce(p_subscription -> 'keys' ->> 'auth', '') = ''
     OR octet_length(p_subscription::text) > 4096 THEN
    RAISE EXCEPTION 'invalid push subscription' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO push_subscriptions (user_id, endpoint, subscription, label, updated_at, fail_count)
  VALUES (v_uid, v_endpoint, p_subscription::text, left(p_label, 60), now(), 0)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = v_uid, subscription = EXCLUDED.subscription,
        label = coalesce(EXCLUDED.label, push_subscriptions.label),
        updated_at = now(), fail_count = 0
  RETURNING id INTO v_id;

  -- Keep at most 10 devices per account (oldest go first).
  DELETE FROM push_subscriptions
   WHERE user_id = v_uid
     AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = v_uid ORDER BY updated_at DESC LIMIT 10);

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_endpoint text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$function$;


-- =====================================================================
-- 2. notification_prefs
-- =====================================================================

-- A vibration pattern: 1–24 whole numbers of ms, each 0–1000, total ≤ 6s.
CREATE OR REPLACE FUNCTION public.is_valid_vibration(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    jsonb_typeof(p) = 'array'
    AND jsonb_array_length(p) BETWEEN 1 AND 24
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e
      WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}')::numeric NOT BETWEEN 0 AND 1000
         OR (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
    )
    AND (SELECT sum((e #>> '{}')::numeric) FROM jsonb_array_elements(p) e) <= 6000,
    false);
$function$;

-- { "<sender uuid>": <pattern>, ... } — at most 30 people.
CREATE OR REPLACE FUNCTION public.is_valid_vibration_map(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    jsonb_typeof(p) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p)) <= 30
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) e
      WHERE e.key !~ '^[0-9a-fA-F-]{36}$' OR NOT public.is_valid_vibration(e.value)
    ),
    false);
$function$;

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id         uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  messages        boolean NOT NULL DEFAULT true,
  friend_requests boolean NOT NULL DEFAULT true,
  theme_changes   boolean NOT NULL DEFAULT true,
  calls           boolean NOT NULL DEFAULT true,   -- stored now; calls don't push yet
  -- what the lock screen shows: 'full' name + text, 'sender' name only,
  -- 'secret' nothing ("Something sweet arrived"). Locked chats are always secret.
  peek            text NOT NULL DEFAULT 'full' CHECK (peek IN ('full', 'sender', 'secret')),
  timezone        text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) <= 64),
  vibration       jsonb CHECK (vibration IS NULL OR public.is_valid_vibration(vibration)),
  vibration_by_sender jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.is_valid_vibration_map(vibration_by_sender)),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A timezone the database doesn't know would make every jar check fail.
CREATE OR REPLACE FUNCTION public.notification_prefs_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
      RAISE EXCEPTION 'unknown timezone: %', NEW.timezone USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS notification_prefs_validate ON public.notification_prefs;
CREATE TRIGGER notification_prefs_validate
  BEFORE INSERT OR UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.notification_prefs_validate();


-- =====================================================================
-- 3. Bedtime Jars
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.notification_jars (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  -- picks the wake-up greeting together with end_time
  kind           text NOT NULL DEFAULT 'custom' CHECK (kind IN ('night', 'work', 'study', 'me', 'custom')),
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  -- ISO weekdays the jar STARTS on (1 = Monday … 7 = Sunday). An overnight
  -- jar (22:00 → 07:00) set for Friday runs Friday night into Saturday.
  days           smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],
  -- "Sweethearts break through": these people are never held in this jar
  break_through  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  enabled        boolean NOT NULL DEFAULT true,
  last_digest_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_jars_span  CHECK (start_time <> end_time),
  CONSTRAINT notification_jars_days  CHECK (cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT notification_jars_vips  CHECK (cardinality(break_through) <= 20)
);
CREATE INDEX IF NOT EXISTS notification_jars_user_idx ON public.notification_jars (user_id);

CREATE OR REPLACE FUNCTION public.notification_jars_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM notification_jars WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'notification_jars: limit of 3 jars reached' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS notification_jars_limit ON public.notification_jars;
CREATE TRIGGER notification_jars_limit
  BEFORE INSERT OR UPDATE ON public.notification_jars
  FOR EACH ROW EXECUTE FUNCTION public.notification_jars_limit();

CREATE TABLE IF NOT EXISTS public.notification_jar_items (
  jar_id    uuid NOT NULL REFERENCES public.notification_jars(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- messages from a locked (vault) chat are counted but never named
  locked    boolean NOT NULL DEFAULT false,
  count     integer NOT NULL DEFAULT 1 CHECK (count > 0),
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jar_id, sender_id, locked)
);


-- =====================================================================
-- 4. Jar helpers (the edge function and the cron job use these)
-- =====================================================================

-- Is a jar holding messages at moment p_at, in timezone p_tz?
CREATE OR REPLACE FUNCTION public.jar_is_active(
  p_start time, p_end time, p_days smallint[], p_tz text, p_at timestamptz DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local timestamp;
  v_t time;
  v_d smallint;
  v_prev smallint;
BEGIN
  BEGIN
    v_local := p_at AT TIME ZONE coalesce(p_tz, 'UTC');
  EXCEPTION WHEN others THEN
    v_local := p_at AT TIME ZONE 'UTC';
  END;
  v_t := v_local::time;
  v_d := extract(isodow FROM v_local)::smallint;
  v_prev := CASE WHEN v_d = 1 THEN 7 ELSE v_d - 1 END;

  IF p_start < p_end THEN                       -- same day, e.g. 10:00 → 17:00
    RETURN v_d = ANY (p_days) AND v_t >= p_start AND v_t < p_end;
  END IF;
  RETURN (v_d = ANY (p_days) AND v_t >= p_start)  -- overnight, e.g. 22:00 → 07:00
      OR (v_prev = ANY (p_days) AND v_t < p_end);
END $function$;

-- The jar a message from p_sender to p_user should go into right now, or
-- NULL (push normally). Overlapping jars: the one that ends first wins, so a
-- message is only ever counted once.
CREATE OR REPLACE FUNCTION public.active_quiet_jar(p_user uuid, p_sender uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id
  FROM notification_jars j
  LEFT JOIN notification_prefs p ON p.user_id = j.user_id
  WHERE j.user_id = p_user
    AND j.enabled
    AND NOT (p_sender = ANY (j.break_through))
    AND public.jar_is_active(j.start_time, j.end_time, j.days, coalesce(p.timezone, 'UTC'))
  ORDER BY (j.end_time - (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
            + CASE WHEN j.end_time <= (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
                   THEN interval '24 hours' ELSE interval '0' END)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.jar_add_item(p_jar uuid, p_sender uuid, p_locked boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO notification_jar_items (jar_id, sender_id, locked)
  VALUES (p_jar, p_sender, coalesce(p_locked, false))
  ON CONFLICT (jar_id, sender_id, locked)
  DO UPDATE SET count = notification_jar_items.count + 1, last_at = now();
$function$;

-- Jars whose quiet hours are over (and no other jar of the user is quiet
-- right now) that have something inside. Each one
-- is emptied and returned ONCE (rows are locked, so two overlapping cron
-- runs can't send the same digest twice).
CREATE OR REPLACE FUNCTION public.claim_due_jar_digests()
 RETURNS TABLE (jar_id uuid, user_id uuid, name text, kind text, end_time time, timezone text, items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE r record;
BEGIN
  FOR r IN
    SELECT j.id, j.user_id, j.name, j.kind, j.end_time, coalesce(p.timezone, 'UTC') AS tz
    FROM notification_jars j
    LEFT JOIN notification_prefs p ON p.user_id = j.user_id
    WHERE EXISTS (SELECT 1 FROM notification_jar_items i WHERE i.jar_id = j.id)
      AND NOT (j.enabled AND public.jar_is_active(j.start_time, j.end_time, j.days, coalesce(p.timezone, 'UTC')))
      -- wait while another of the user's jars is still quiet (overlap)
      AND NOT EXISTS (
        SELECT 1 FROM notification_jars o
        WHERE o.user_id = j.user_id AND o.id <> j.id AND o.enabled
          AND public.jar_is_active(o.start_time, o.end_time, o.days, coalesce(p.timezone, 'UTC')))
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    jar_id := r.id; user_id := r.user_id; name := r.name; kind := r.kind;
    end_time := r.end_time; timezone := r.tz;
    SELECT coalesce(jsonb_agg(jsonb_build_object('sender_id', i.sender_id, 'count', i.count, 'locked', i.locked)
                              ORDER BY i.count DESC), '[]'::jsonb)
      INTO items
      FROM notification_jar_items i WHERE i.jar_id = r.id;
    DELETE FROM notification_jar_items i WHERE i.jar_id = r.id;
    UPDATE notification_jars SET last_digest_at = now() WHERE id = r.id;
    RETURN NEXT;
  END LOOP;
END $function$;


-- =====================================================================
-- 5. Friend-request push (same secret + endpoint as the message trigger)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_push_on_friend_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://ptezdlwwnjrsqomsspgi.supabase.co/functions/v1/send-sweet-push',
    body := jsonb_build_object('action', 'friend_request', 'request_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- never let a push problem stop a friend request
END $function$;

DROP TRIGGER IF EXISTS notify_push_on_friend_request ON public.friend_requests;
CREATE TRIGGER notify_push_on_friend_request
  AFTER INSERT ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_friend_request();


-- =====================================================================
-- 6. Wake-up digest: checked every 5 minutes. The check itself is a cheap
--    query; the edge function is only called when a jar is actually due.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trigger_jar_digests()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM notification_jars j
    LEFT JOIN notification_prefs p ON p.user_id = j.user_id
    WHERE EXISTS (SELECT 1 FROM notification_jar_items i WHERE i.jar_id = j.id)
      AND NOT (j.enabled AND public.jar_is_active(j.start_time, j.end_time, j.days, coalesce(p.timezone, 'UTC')))
      -- wait while another of the user's jars is still quiet (overlap)
      AND NOT EXISTS (
        SELECT 1 FROM notification_jars o
        WHERE o.user_id = j.user_id AND o.id <> j.id AND o.enabled
          AND public.jar_is_active(o.start_time, o.end_time, o.days, coalesce(p.timezone, 'UTC')))
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := 'https://ptezdlwwnjrsqomsspgi.supabase.co/functions/v1/send-sweet-push',
    body := jsonb_build_object('action', 'digest'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
END $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweet-jar-digest') THEN
    PERFORM cron.unschedule('sweet-jar-digest');
  END IF;
  PERFORM cron.schedule('sweet-jar-digest', '*/5 * * * *', 'select public.trigger_jar_digests();');
END $$;


-- =====================================================================
-- 7. RLS + grants
-- =====================================================================
ALTER TABLE public.notification_prefs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jars      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jar_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_prefs: own row" ON public.notification_prefs;
CREATE POLICY "notification_prefs: own row" ON public.notification_prefs
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_jars: own rows" ON public.notification_jars;
CREATE POLICY "notification_jars: own rows" ON public.notification_jars
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Users can see what waits in their jars and empty them; only the server fills them.
DROP POLICY IF EXISTS "notification_jar_items: view own" ON public.notification_jar_items;
CREATE POLICY "notification_jar_items: view own" ON public.notification_jar_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notification_jars j WHERE j.id = jar_id AND j.user_id = auth.uid()));
DROP POLICY IF EXISTS "notification_jar_items: empty own" ON public.notification_jar_items;
CREATE POLICY "notification_jar_items: empty own" ON public.notification_jar_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notification_jars j WHERE j.id = jar_id AND j.user_id = auth.uid()));

-- Devices are registered through the RPCs above; reading your own list
-- ("this device", device count) is still allowed by the existing
-- "push: own row" policy.
REVOKE ALL ON public.notification_prefs, public.notification_jars, public.notification_jar_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_jars  TO authenticated;
GRANT SELECT, DELETE                 ON public.notification_jar_items TO authenticated;

REVOKE ALL ON FUNCTION public.register_push_device(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_push_device(text)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text)      TO authenticated, service_role;

-- Server-only helpers.
REVOKE ALL ON FUNCTION public.active_quiet_jar(uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jar_add_item(uuid, uuid, boolean)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_jar_digests()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_jar_digests()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_push_on_friend_request()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_jars_limit()             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.active_quiet_jar(uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.jar_add_item(uuid, uuid, boolean)  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_jar_digests()            TO service_role;
GRANT EXECUTE ON FUNCTION public.trigger_jar_digests()              TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_push_on_friend_request()    TO service_role;
