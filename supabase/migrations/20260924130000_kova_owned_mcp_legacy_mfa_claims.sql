-- Express the hosted factor lookup through the mapped legacy user ID.
-- The stable UUID constraint already makes this equal to the owned account ID
-- for linked accounts; retaining this explicit mapping protects future edits.
begin;
-- Live Kova compatibility-token validation for server bearer consumers such as
-- MCP. Cryptographic verification happens in the Kova server first; this RPC
-- rechecks the signed account/session claims against current database state.
create or replace function public.kova_auth_validate_compatibility_session(
  p_account_id uuid,
  p_session_id uuid,
  p_email text,
  p_assurance_level text,
  p_issued_at_epoch bigint,
  p_now timestamptz default now()
) returns boolean
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select
    p_account_id is not null
    and p_session_id is not null
    and p_email is not null
    and p_email = lower(btrim(p_email))
    and p_assurance_level in ('aal1', 'aal2')
    and p_issued_at_epoch is not null
    and p_now is not null
    and isfinite(p_now)
    and exists (
      select 1
        from kova_private.auth_sessions s
        join kova_private.auth_accounts a on a.id = s.account_id
       where s.id = p_session_id
         and s.account_id = p_account_id
         and s.revoked_at is null
         and s.created_at <= p_now
         and s.expires_at > p_now
         and s.session_epoch = a.session_epoch
         and s.assurance_level = p_assurance_level
         and a.primary_email = p_email
         and a.email_verified_at is not null
         and a.deleted_at is null
         and (a.suspended_until is null or a.suspended_until <= p_now)
         and (
           a.legacy_supabase_user_id is null
           or kova_private.legacy_principal_permitted(a.legacy_supabase_user_id)
         )
         and (
           not (a.mfa_required or kova_private.legacy_mfa_required(a.legacy_supabase_user_id))
           or p_assurance_level = 'aal2'
         )
         and p_issued_at_epoch >= floor(extract(epoch from s.created_at))::bigint - 5
         and p_issued_at_epoch <= floor(extract(epoch from p_now))::bigint + 5
    )
$$;

revoke all on function public.kova_auth_validate_compatibility_session(
  uuid,uuid,text,text,bigint,timestamptz
) from public, anon, authenticated;
grant execute on function public.kova_auth_validate_compatibility_session(
  uuid,uuid,text,text,bigint,timestamptz
) to service_role;

commit;
