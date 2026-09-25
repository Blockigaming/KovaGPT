-- feature_flags is a server-managed global registry. Its only in-app reader is
-- src/lib/api-auth.server.ts through the service_role admin client, which is
-- exempt from RLS, so the permissive authenticated SELECT policy grants nothing
-- the app needs. Removing the Data API read path closes the exposure without
-- changing behavior.
drop policy if exists "feature_flags_authenticated_read" on public.feature_flags;
revoke select on table public.feature_flags from authenticated;
