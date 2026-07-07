DROP POLICY IF EXISTS "own tokens select" ON public.google_oauth_tokens;
REVOKE SELECT ON public.google_oauth_tokens FROM authenticated;
GRANT DELETE ON public.google_oauth_tokens TO authenticated;