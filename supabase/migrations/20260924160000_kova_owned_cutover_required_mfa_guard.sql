-- Count every verified owned account that requires MFA but lacks a usable
-- owned TOTP factor, even after its hosted factors have been removed.
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
     and a.email_verified_at <= p_now
     and (
       a.mfa_required
       or (
         a.legacy_supabase_user_id is not null
         and kova_private.legacy_mfa_required(a.legacy_supabase_user_id)
       )
     )
     and not exists(
       select 1 from kova_private.auth_mfa_factors f
        where f.account_id = a.id and f.factor_type = 'totp'
          and f.state = 'active' and f.verified_at is not null
          and f.verified_at <= p_now and f.disabled_at is null
     );
  return v_gaps;
end
$$;
revoke all on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  to service_role;

commit;
