/*
  # Let a signed-out device release its own push address

  A device that signed out on an old app version, offline, or with an
  expired session could not remove itself (unregister_push_device needs a
  signed-in user), so it kept getting the old account's notifications.

  release_push_device(endpoint) deletes the row for that ONE push address,
  without needing a session. That is safe because the endpoint is a long,
  unguessable URL issued by the browser's push service to that browser only:
  knowing it is proof you hold the subscription. The app calls this whenever
  it finds nobody signed in.

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION public.release_push_device(p_endpoint text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM push_subscriptions
  WHERE endpoint = p_endpoint
    AND p_endpoint ~ '^https://'
    AND char_length(p_endpoint) BETWEEN 40 AND 1000;
$function$;

REVOKE ALL ON FUNCTION public.release_push_device(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_push_device(text) TO anon, authenticated, service_role;
