-- 1) feature_flags: signed-in read only, no client writes
DROP POLICY IF EXISTS "Flags are publicly readable" ON public.feature_flags;
REVOKE ALL PRIVILEGES ON TABLE public.feature_flags FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.feature_flags FROM authenticated;
GRANT SELECT ON TABLE public.feature_flags TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.feature_flags TO service_role;
CREATE POLICY "feature_flags_authenticated_read"
  ON public.feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "feature_flags_deny_client_insert"
  ON public.feature_flags AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "feature_flags_deny_client_update"
  ON public.feature_flags AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false);
CREATE POLICY "feature_flags_deny_client_delete"
  ON public.feature_flags AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- 2) financial_accounts: reads stay owner-scoped, writes are service-role only
REVOKE ALL PRIVILEGES ON TABLE public.financial_accounts FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.financial_accounts FROM authenticated;
GRANT SELECT ON TABLE public.financial_accounts TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.financial_accounts TO service_role;
CREATE POLICY "financial_accounts_deny_client_insert"
  ON public.financial_accounts AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "financial_accounts_deny_client_update"
  ON public.financial_accounts AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false);
CREATE POLICY "financial_accounts_deny_client_delete"
  ON public.financial_accounts AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- 3) google_oauth_tokens: keep owner-scoped delete, block client insert/update explicitly
REVOKE ALL PRIVILEGES ON TABLE public.google_oauth_tokens FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.google_oauth_tokens FROM authenticated;
GRANT DELETE ON TABLE public.google_oauth_tokens TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.google_oauth_tokens TO service_role;
CREATE POLICY "google_oauth_tokens_deny_client_insert"
  ON public.google_oauth_tokens AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "google_oauth_tokens_deny_client_update"
  ON public.google_oauth_tokens AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false);

-- 4) internal-only SECURITY DEFINER helpers are not directly callable by clients
REVOKE ALL ON FUNCTION public.project_role_of(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projects_add_owner_member() FROM PUBLIC, anon, authenticated;
