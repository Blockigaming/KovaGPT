-- Existing SECURITY INVOKER facades and RLS policies call private helpers as
-- authenticated. The owned Auth store revoked schema USAGE, unintentionally
-- disabling those already scoped helpers. Restore that existing role access
-- only after checking that owned Auth data and routines remain inaccessible.
do $migration$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kova_private' and c.relname like 'auth\_%' escape '\'
      and c.relkind in ('r','p','v','m')
      and has_table_privilege('authenticated', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kova_private'
      and p.proname in (
        'require_digest', 'audit', 'legacy_mfa_required',
        'verified_auth_user_for_email', 'lock_auth_session',
        'rotate_security_session', 'auth_account_available',
        'bind_primary_auth_challenge', 'guard_legacy_account_adoption',
        'retire_legacy_password_on_owned_change', 'adopt_compatibility_candidate',
        'bind_recovery_account_authority', 'legacy_principal_permitted',
        'guard_legacy_adoption', 'retire_legacy_auth', 'retire_password_authority',
        'guard_session_legacy_principal', 'site_authorized_session',
        'issue_site_ticket_authorized'
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'owned_auth_private_client_grant';
  end if;
end
$migration$;

grant usage on schema kova_private to authenticated;
