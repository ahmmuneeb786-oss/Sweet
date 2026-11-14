/*
  # Guard chats.shared_theme

  Chat members may update their chat row (name, avatar, …), so without this
  they could also change the "Both of us" theme directly and skip the
  'theme_change' message — the other person would never be told.

  Now the shared_theme columns can only change through
  set_shared_chat_theme(), which always posts that message. It marks its
  own transaction with a setting; this trigger rejects any other change.

  Run AFTER 20261113120000_custom_themes.sql. Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION public.guard_shared_theme_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.shared_theme    IS DISTINCT FROM OLD.shared_theme
   OR NEW.shared_theme_by IS DISTINCT FROM OLD.shared_theme_by
   OR NEW.shared_theme_at IS DISTINCT FROM OLD.shared_theme_at)
     AND auth.uid() IS NOT NULL  -- service role / dashboard edits still allowed
     AND coalesce(current_setting('sweet.shared_theme_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'chats: change the shared theme with set_shared_chat_theme()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS guard_shared_theme_update ON public.chats;
CREATE TRIGGER guard_shared_theme_update
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.guard_shared_theme_update();

REVOKE ALL ON FUNCTION public.guard_shared_theme_update() FROM PUBLIC, anon, authenticated;

-- Same function as before, plus the transaction-local flag (third argument
-- `true` = resets automatically when this transaction ends).
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

  PERFORM set_config('sweet.shared_theme_rpc', 'on', true);

  UPDATE chats
     SET shared_theme    = p_theme,
         shared_theme_by = v_uid,
         shared_theme_at = now(),
         updated_at      = now()
   WHERE id = p_chat_id;

  PERFORM set_config('sweet.shared_theme_rpc', 'off', true);

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

REVOKE ALL ON FUNCTION public.set_shared_chat_theme(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shared_chat_theme(text, jsonb) TO authenticated, service_role;
