-- Google access and refresh tokens are server credentials. Browser roles must never read or
-- delete them directly, even for their own user row. Disconnects continue through the
-- authenticated server route, which uses the service role after verifying the caller.
--
-- This migration changes privileges and policies only. It does not read, rewrite, or delete
-- any stored token row.

REVOKE ALL PRIVILEGES ON TABLE public.google_oauth_tokens
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "own tokens select" ON public.google_oauth_tokens;
DROP POLICY IF EXISTS "own tokens delete" ON public.google_oauth_tokens;

GRANT ALL PRIVILEGES ON TABLE public.google_oauth_tokens TO service_role;
