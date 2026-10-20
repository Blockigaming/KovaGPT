-- All account notifications are enabled by default. Existing saved choices
-- remain authoritative; this does not overwrite any user's stored opt-out.
begin;

create or replace function kova_private.account_email_defaults() returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select '{"password_changed":true,"security_method_added":true,"security_method_changed":true,"security_method_removed":true,"account_deletion_scheduled":true,"account_deleted":true,"new_login":true,"email_changed":true,"account_recovered":true}'::jsonb
$$;

revoke all on function kova_private.account_email_defaults() from public, anon, authenticated, service_role;

commit;
