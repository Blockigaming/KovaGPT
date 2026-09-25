-- Bind a verified TOTP factor to a still-live, unconsumed challenge.
begin;
create function public.kova_auth_bind_mfa_login_factor(
  p_challenge_digest_hex text, p_factor_id uuid, p_now timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_account_id uuid; v_challenge kova_private.auth_mfa_login_challenges;
begin
  if p_now is null or not isfinite(p_now) or p_factor_id is null then
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  select account_id into v_account_id from kova_private.auth_mfa_login_challenges
    where token_digest = kova_private.require_digest(p_challenge_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  perform 1 from kova_private.auth_accounts where id = v_account_id for update;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
    where token_digest = kova_private.require_digest(p_challenge_digest_hex)
      and account_id = v_account_id and consumed_at is null and expires_at > p_now
      and attempts between 1 and 5 for update;
  if v_challenge.id is null or not exists (
    select 1 from kova_private.auth_mfa_factors f
      where f.id = p_factor_id and f.account_id = v_account_id
        and f.factor_type = 'totp' and f.state = 'active'
        and f.verified_at is not null and f.disabled_at is null
  ) then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  update kova_private.auth_mfa_login_challenges set factor_id = p_factor_id
    where id = v_challenge.id;
  return true;
end
$$;
revoke all on function public.kova_auth_bind_mfa_login_factor(text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_bind_mfa_login_factor(text,uuid,timestamptz)
  to service_role;

-- The owned session remains active; all hosted authority for this account ends.
create or replace function public.kova_auth_revoke_other_sessions(
  p_session_digest_hex text, p_now timestamptz default now()
) returns integer
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions; v_epoch bigint; v_revoked integer; v_legacy uuid;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select legacy_supabase_user_id into v_legacy from kova_private.auth_accounts
    where id = v_session.account_id for update;
  update kova_private.auth_accounts set session_epoch = session_epoch + 1, updated_at = p_now
    where id = v_session.account_id returning session_epoch into v_epoch;
  update kova_private.auth_sessions set session_epoch = v_epoch where id = v_session.id;
  update kova_private.auth_sessions set revoked_at = p_now
    where account_id = v_session.account_id and id <> v_session.id and revoked_at is null;
  get diagnostics v_revoked = row_count;
  if v_legacy is not null then
    insert into kova_private.auth_legacy_retirements(account_id, retired_at)
      values(v_legacy, p_now) on conflict(account_id) do nothing;
    delete from auth.sessions where user_id = v_legacy;
  end if;
  perform kova_private.audit(v_session.account_id, v_session.id, 'other_sessions_revoked',
    'success', jsonb_build_object('revoked_count', v_revoked), p_now);
  return v_revoked;
end
$$;
commit;
