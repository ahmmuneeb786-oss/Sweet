/*
  Part 3: push notifications without the service-role key in the database.

  The old trigger `on_new_message_push` embedded the service-role key (which
  bypasses ALL security) in its definition and posted the whole message row
  to the push function. The new trigger sends only the message id plus a
  shared secret kept in Supabase Vault; the function loads everything else
  itself and rejects calls without the secret.

  Before applying: store the secret in Vault and in the function's secrets
  (same value), and deploy the new function — see the instructions given
  with this migration. If the Vault secret is missing, the trigger simply
  skips the push; sending messages is never blocked by push problems.
*/

BEGIN;

DROP TRIGGER IF EXISTS on_new_message_push ON public.messages;

CREATE OR REPLACE FUNCTION public.notify_push_on_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- never let a push problem stop a message from being sent
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_push_on_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notify_push_on_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_message();

COMMIT;
