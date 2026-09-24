-- Cutover evidence must include temporarily suspended legacy MFA accounts and
-- every real hosted principal, including users who never entered dual mode.
-- This migration counts gaps only; it does not adopt or alter any user.
begin;

create or replace function public.kova_auth_legacy_mfa_gap_count(p_now timestamptz default now())
returns bigint
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_gaps bigint;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_capture_time';
  end if;
  select count(*) into v_gaps
    from kova_private.auth_accounts a
   where a.deleted_at is null
     and a.email_verified_at is not null
     and a.legacy_supabase_user_id is not null
     and kova_private.legacy_mfa_required(a.legacy_supabase_user_id)
     and not exists(
       select 1 from kova_private.auth_mfa_factors f
        where f.account_id = a.id and f.factor_type = 'totp'
          and f.state = 'active' and f.verified_at is not null
          and f.disabled_at is null
     );
  return v_gaps;
end
$$;
revoke all on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  to service_role;

create function public.kova_auth_legacy_adoption_gap_count(p_now timestamptz default now())
returns bigint
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare v_gaps bigint;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_capture_time';
  end if;
  select count(*) into v_gaps
    from auth.users u
   where u.deleted_at is null
     and not coalesce(u.is_anonymous, false)
     -- Inert Kova UUID bridges are not hosted login principals. Only the
     -- full shape of a generated shadow excludes it from this census.
     and not (
       coalesce(u.raw_app_meta_data->>'provider', '') = 'kova_shadow'
       and coalesce(u.raw_user_meta_data->>'kova_shadow', '') = 'true'
       and u.email is not distinct from 'shadow+' || u.id || '@auth.invalid.kovagpt.com'
       and u.encrypted_password is null and u.email_confirmed_at is null
       and u.banned_until is not distinct from 'infinity'::timestamptz
       and not exists(select 1 from auth.identities i where i.user_id = u.id)
     )
     and not exists(
       select 1 from kova_private.auth_accounts a
        where a.id = u.id and a.legacy_supabase_user_id = u.id
          and a.deleted_at is null and a.email_verified_at is not null
          and a.email_verified_at <= p_now
          and (
            exists(
              select 1 from kova_private.auth_credentials c
               where c.account_id = a.id and c.credential_type = 'password'
                 and c.activated_at is not null and c.activated_at <= p_now
                 and c.disabled_at is null
            )
            or exists(
              select 1 from kova_private.auth_identities i
               where i.account_id = a.id and i.provider = 'google'
                 and i.verified_at is not null and i.verified_at <= p_now
                 and i.disabled_at is null and i.normalized_email = a.primary_email
            )
            or exists(
              select 1 from kova_private.auth_passkeys p
               where p.account_id = a.id and p.disabled_at is null
            )
          )
     );
  return v_gaps;
end
$$;
revoke all on function public.kova_auth_legacy_adoption_gap_count(timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_adoption_gap_count(timestamptz)
  to service_role;

commit;
