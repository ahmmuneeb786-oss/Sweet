/*
  Give the push function 10 s instead of 5 s to answer. The first call after
  a quiet period (cold start) sometimes took just over 5 s, so that one
  notification was dropped. Messages themselves were never affected.
*/

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
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- never let a push problem stop a message from being sent
END $$;
