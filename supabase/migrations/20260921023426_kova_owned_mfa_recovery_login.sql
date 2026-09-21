create function public.kova_auth_finish_mfa_recovery_login(
  p_challenge_digest_hex text, p_recovery_digest_hex text, p_token_digest_hex text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_challenge kova_private.auth_mfa_login_challenges;
  v_recovery kova_private.auth_mfa_recovery_codes;
  v_account kova_private.auth_accounts;
  v_session_id uuid;
begin
  if p_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and consumed_at is null and expires_at > p_now and attempts between 1 and 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  select * into v_recovery from kova_private.auth_mfa_recovery_codes
   where account_id = v_challenge.account_id
     and code_digest = kova_private.require_digest(p_recovery_digest_hex)
     and consumed_at is null for update;
  if v_recovery.id is null then raise exception 'kova_auth_invalid_recovery_code'; end if;
  select * into v_account from kova_private.auth_accounts where id = v_challenge.account_id for update;
  if v_account.id is null or v_account.deleted_at is not null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or not exists (
      select 1 from kova_private.auth_credentials c where c.id = v_challenge.credential_id
        and c.account_id = v_challenge.account_id and c.revision = v_challenge.credential_revision
        and c.activated_at is not null and c.disabled_at is null
    ) then raise exception 'kova_auth_account_unavailable'; end if;
  update kova_private.auth_mfa_recovery_codes set consumed_at = p_now where id = v_recovery.id;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now where id = v_challenge.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_token_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'mfa_recovery_login', 'success',
    jsonb_build_object('factor_id', v_challenge.factor_id, 'recovery_code_id', v_recovery.id), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email,
    true, 'aal2'::text, p_expires_at;
end
$$;

revoke all on function public.kova_auth_finish_mfa_recovery_login(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.kova_auth_finish_mfa_recovery_login(text, text, text, timestamptz, timestamptz) to service_role;
