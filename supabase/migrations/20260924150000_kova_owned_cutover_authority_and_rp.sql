-- Require a usable passkey for the audited public-origin RP and demonstrably
-- retired hosted authority before the final cutover. No user rows are changed.
begin;

-- Do not leave a service-executable census that can omit the deployment RP.
drop function public.kova_auth_legacy_adoption_gap_count(timestamptz) restrict;

create function public.kova_auth_legacy_adoption_gap_count(
  p_rp_id text, p_now timestamptz default now()
) returns bigint
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s' as $$
declare v_gaps bigint;
begin
  if p_now is null or not isfinite(p_now) or p_rp_id is null
    or char_length(p_rp_id) not between 3 and 253
    or p_rp_id !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' then
    raise exception 'kova_auth_invalid_cutover_configuration';
  end if;
  select count(*) into v_gaps
    from auth.users u
   where u.deleted_at is null
     and not coalesce(u.is_anonymous, false)
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
          -- A hosted password or refresh session must not survive the switch.
          -- The persistent marker also denies already-issued legacy JWTs and
          -- any new hosted OAuth tokens at the database request guard.
          and u.encrypted_password is null
          and exists(
            select 1 from kova_private.auth_legacy_retirements r
             where r.account_id = u.id and r.retired_at <= p_now
          )
          and not exists(select 1 from auth.sessions s where s.user_id = u.id)
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
                 and p.rp_id = p_rp_id and p.created_at <= p_now
            )
          )
     );
  return v_gaps;
end
$$;
revoke all on function public.kova_auth_legacy_adoption_gap_count(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_adoption_gap_count(text,timestamptz)
  to service_role;

commit;
