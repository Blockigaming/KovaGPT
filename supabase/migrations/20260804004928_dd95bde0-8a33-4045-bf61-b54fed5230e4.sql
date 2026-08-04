-- 1) Pin search_path on email queue helper functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 2) Explicitly deny client-role access to service-role-only tables
DROP POLICY IF EXISTS "banned_users_deny_clients" ON public.banned_users;
CREATE POLICY "banned_users_deny_clients" ON public.banned_users AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ai_generation_events_deny_clients" ON public.ai_generation_events;
CREATE POLICY "ai_generation_events_deny_clients" ON public.ai_generation_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "pending_tool_actions_deny_clients" ON public.pending_tool_actions;
CREATE POLICY "pending_tool_actions_deny_clients" ON public.pending_tool_actions AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "processed_stripe_events_deny_clients" ON public.processed_stripe_events;
CREATE POLICY "processed_stripe_events_deny_clients" ON public.processed_stripe_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "plaid_items_deny_clients" ON public.plaid_items;
CREATE POLICY "plaid_items_deny_clients" ON public.plaid_items AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 3) Never allow client reads of stored Google OAuth tokens
DROP POLICY IF EXISTS "google_oauth_tokens_deny_client_reads" ON public.google_oauth_tokens;
CREATE POLICY "google_oauth_tokens_deny_client_reads" ON public.google_oauth_tokens AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (false);

-- 4) Re-assert that no Data API privileges exist on these internal tables
REVOKE ALL ON public.banned_users FROM anon, authenticated;
REVOKE ALL ON public.ai_generation_events FROM anon, authenticated;
REVOKE ALL ON public.pending_tool_actions FROM anon, authenticated;
REVOKE ALL ON public.processed_stripe_events FROM anon, authenticated;
REVOKE ALL ON public.plaid_items FROM anon, authenticated;
GRANT ALL ON public.banned_users TO service_role;
GRANT ALL ON public.ai_generation_events TO service_role;
GRANT ALL ON public.pending_tool_actions TO service_role;
GRANT ALL ON public.processed_stripe_events TO service_role;
GRANT ALL ON public.plaid_items TO service_role;
GRANT ALL ON public.google_oauth_tokens TO service_role;