/*
  # Push devices: register only through register_push_device()

  The baseline policy "push: own row" was FOR ALL, so a signed-in user could
  still INSERT/UPDATE their own push_subscriptions rows directly and skip the
  checks in register_push_device() (valid endpoint, keys, size, 10-device cap).
  It never let anyone touch another user's rows, so this is hardening, not a
  hole: users keep READ (the Settings device count) and DELETE of their own
  rows; writing goes through the RPC (SECURITY DEFINER), and the push edge
  function uses the service role, which RLS doesn't apply to.

  Safe to run more than once.
*/

DROP POLICY IF EXISTS "push: own row" ON public.push_subscriptions;

DROP POLICY IF EXISTS "push: view own" ON public.push_subscriptions;
CREATE POLICY "push: view own" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push: delete own" ON public.push_subscriptions;
CREATE POLICY "push: delete own" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE ON public.push_subscriptions FROM authenticated, anon;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;
