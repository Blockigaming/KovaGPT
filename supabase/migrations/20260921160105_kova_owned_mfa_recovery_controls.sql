-- Owned recovery-code replacement and device-session revocation. No account
-- data, credentials, provider configuration, or production state is migrated.

-- Retire the earlier staging-only ABI, which did not rotate the current
-- session. RESTRICT deliberately fails if another object still depends on it.
drop function if exists public.kova_auth_regenerate_mfa_recovery_codes(text,text[],timestamptz) restrict;

-- Lock the account before the session so simultaneous security operations on
-- different devices serialize. Re-read all state after acquiring the locks.
create function kova_private.lock_auth_session(
  p_session_digest_hex text, p_now timestamptz
) returns kova_private.auth_sessions
language plpgsql security invoker set search_path = '' as $$
declare
  v_account_id uuid;
  v_account kova_private.auth_accounts;
  v_session kova_private.auth_sessions;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_session';
  end if;
  select s.account_id into v_account_id from kova_private.auth_sessions s
   where s.token_digest = kova_private.require_digest(p_session_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_account from kova_private.auth_accounts
   where id = v_account_id for update;
  select * into v_session from kova_private.auth_sessions
   where token_digest = kova_private.require_digest(p_session_digest_hex)
     and account_id = v_account_id for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_session.id is null or v_session.revoked_at is not null
    or v_session.expires_at <= p_now or v_session.created_at > p_now
    or v_session.session_epoch <> v_account.session_epoch
    or ((v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id))
      and v_session.assurance_level <> 'aal2') then
    raise exception 'kova_auth_invalid_session';
  end if;
  return v_session;
end
$$;
revoke all on function kova_private.lock_auth_session(text,timestamptz)
  from public, anon, authenticated, service_role;

create function public.kova_auth_regenerate_mfa_recovery_codes(
  p_session_digest_hex text, p_recovery_digest_hexes text[],
  p_next_session_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_session kova_private.auth_sessions;
  v_account kova_private.auth_accounts;
  v_digest text;
  v_session_id uuid;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select * into v_account from kova_private.auth_accounts where id = v_session.account_id;
  if v_session.assurance_level <> 'aal2' or not v_account.mfa_required then
    raise exception 'kova_auth_mfa_required';
  end if;
  perform 1 from kova_private.auth_mfa_factors f
   where f.account_id = v_account.id and f.factor_type = 'totp'
     and f.state = 'active' and f.disabled_at is null and f.verified_at is not null
   for share;
  if not found then raise exception 'kova_auth_mfa_required'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at <= p_now
    or p_next_session_digest_hex = p_session_digest_hex then
    raise exception 'kova_auth_invalid_session';
  end if;
  perform kova_private.require_digest(p_next_session_digest_hex);
  if coalesce(array_ndims(p_recovery_digest_hexes), 0) <> 1
    or coalesce(cardinality(p_recovery_digest_hexes), 0) <> 8 then
    raise exception 'kova_auth_invalid_recovery_codes';
  end if;
  if (select count(distinct d) from unnest(p_recovery_digest_hexes) as codes(d)) <> 8 then
    raise exception 'kova_auth_invalid_recovery_codes';
  end if;
  foreach v_digest in array p_recovery_digest_hexes loop
    perform kova_private.require_digest(v_digest);
    if exists (
      select 1 from kova_private.auth_mfa_recovery_codes r
       where r.code_digest = kova_private.require_digest(v_digest)
    ) then raise exception 'kova_auth_invalid_recovery_codes'; end if;
  end loop;

  delete from kova_private.auth_mfa_recovery_codes where account_id = v_account.id;
  foreach v_digest in array p_recovery_digest_hexes loop
    insert into kova_private.auth_mfa_recovery_codes(account_id, code_digest, created_at)
    values (v_account.id, kova_private.require_digest(v_digest), p_now);
  end loop;

  -- An epoch change also retires a sibling session rotated concurrently with
  -- this transaction; relying only on the UPDATE snapshot would miss it.
  update kova_private.auth_accounts
     set session_epoch = session_epoch + 1, updated_at = p_now
   where id = v_account.id returning * into v_account;
  update kova_private.auth_sessions set revoked_at = p_now
   where account_id = v_account.id and revoked_at is null;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at,
    rotated_from, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_next_session_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, v_session.id, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'mfa_recovery_codes_regenerated',
    'success', jsonb_build_object('code_count', 8), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email,
    true, 'aal2'::text, p_expires_at;
end
$$;

create function public.kova_auth_revoke_other_sessions(
  p_session_digest_hex text, p_now timestamptz default now()
) returns integer
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  v_session kova_private.auth_sessions;
  v_epoch bigint;
  v_revoked integer;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  update kova_private.auth_accounts
     set session_epoch = session_epoch + 1, updated_at = p_now
   where id = v_session.account_id returning session_epoch into v_epoch;
  update kova_private.auth_sessions set session_epoch = v_epoch
   where id = v_session.id;
  update kova_private.auth_sessions set revoked_at = p_now
   where account_id = v_session.account_id and id <> v_session.id and revoked_at is null;
  get diagnostics v_revoked = row_count;
  perform kova_private.audit(v_session.account_id, v_session.id, 'other_sessions_revoked',
    'success', jsonb_build_object('revoked_count', v_revoked), p_now);
  return v_revoked;
end
$$;

-- Recheck the factor at consumption time, not only in the earlier challenge
-- read. Account-first locking agrees with recovery-code regeneration.
create or replace function public.kova_auth_finish_mfa_recovery_login(
  p_challenge_digest_hex text, p_recovery_digest_hex text, p_token_digest_hex text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_account_id uuid;
  v_challenge kova_private.auth_mfa_login_challenges;
  v_account kova_private.auth_accounts;
  v_credential_id uuid;
  v_factor_id uuid;
  v_recovery_id uuid;
  v_session_id uuid;
begin
  if p_now is null or not isfinite(p_now) or p_expires_at is null
    or not isfinite(p_expires_at) or p_expires_at <= p_now then
    raise exception 'kova_auth_invalid_session';
  end if;
  select c.account_id into v_account_id from kova_private.auth_mfa_login_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  select * into v_account from kova_private.auth_accounts where id = v_account_id for update;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and account_id = v_account_id and consumed_at is null and expires_at > p_now
     and attempts between 1 and 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null or not v_account.mfa_required
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  select c.id into v_credential_id from kova_private.auth_credentials c
   where c.id = v_challenge.credential_id and c.account_id = v_account.id
     and c.revision = v_challenge.credential_revision and c.credential_type = 'password'
     and c.activated_at is not null and c.disabled_at is null for share;
  if v_credential_id is null then raise exception 'kova_auth_account_unavailable'; end if;
  select f.id into v_factor_id from kova_private.auth_mfa_factors f
   where f.id = v_challenge.factor_id and f.account_id = v_account.id
     and f.factor_type = 'totp' and f.state = 'active'
     and f.verified_at is not null and f.disabled_at is null for share;
  if v_factor_id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  select r.id into v_recovery_id from kova_private.auth_mfa_recovery_codes r
   where r.account_id = v_account.id
     and r.code_digest = kova_private.require_digest(p_recovery_digest_hex)
     and r.consumed_at is null for update;
  if v_recovery_id is null then raise exception 'kova_auth_invalid_recovery_code'; end if;
  update kova_private.auth_mfa_recovery_codes set consumed_at = p_now where id = v_recovery_id;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now where id = v_challenge.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_token_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'mfa_recovery_login', 'success',
    jsonb_build_object('factor_id', v_challenge.factor_id), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email,
    true, 'aal2'::text, p_expires_at;
end
$$;

revoke all on function public.kova_auth_regenerate_mfa_recovery_codes(text,text[],text,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.kova_auth_revoke_other_sessions(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.kova_auth_finish_mfa_recovery_login(text,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_regenerate_mfa_recovery_codes(text,text[],text,timestamptz,timestamptz)
  to service_role;
grant execute on function public.kova_auth_revoke_other_sessions(text,timestamptz)
  to service_role;
grant execute on function public.kova_auth_finish_mfa_recovery_login(text,text,text,timestamptz,timestamptz)
  to service_role;
