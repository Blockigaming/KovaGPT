-- Complete owned credential mutations without deploying or changing providers.
-- All security mutations lock account -> session -> factor/credential. The
-- account epoch retires concurrently issued sibling sessions as well.

create function kova_private.rotate_security_session(
  p_session kova_private.auth_sessions, p_next_digest_hex text,
  p_assurance_level text, p_expires_at timestamptz,
  p_event_type text, p_metadata jsonb, p_now timestamptz
) returns kova_private.auth_sessions
language plpgsql security invoker set search_path = '' as $$
declare v_epoch bigint; v_next kova_private.auth_sessions;
begin
  if p_now is null or not isfinite(p_now) or p_expires_at is null
    or not isfinite(p_expires_at) or p_expires_at <= p_now
    or p_assurance_level not in ('aal1', 'aal2')
    or kova_private.require_digest(p_next_digest_hex) = p_session.token_digest then
    raise exception 'kova_auth_invalid_session';
  end if;
  update kova_private.auth_accounts set session_epoch = session_epoch + 1, updated_at = p_now
   where id = p_session.account_id returning session_epoch into v_epoch;
  update kova_private.auth_sessions set revoked_at = p_now
   where account_id = p_session.account_id and revoked_at is null;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now
   where account_id = p_session.account_id and consumed_at is null;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at,
    rotated_from, created_at, last_seen_at
  ) values (
    p_session.account_id, kova_private.require_digest(p_next_digest_hex), p_assurance_level,
    v_epoch, p_expires_at, p_session.id, p_now, p_now
  ) returning * into v_next;
  perform kova_private.audit(p_session.account_id, v_next.id, p_event_type,
    'success', p_metadata, p_now);
  return v_next;
end
$$;
revoke all on function kova_private.rotate_security_session(kova_private.auth_sessions,text,text,timestamptz,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.kova_auth_activate_totp_with_session(
  p_session_digest_hex text, p_factor_id uuid, p_recovery_digest_hexes text[],
  p_next_session_digest_hex text, p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_session kova_private.auth_sessions;
  v_next kova_private.auth_sessions;
  v_factor_id uuid;
  v_digest text;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select f.id into v_factor_id from kova_private.auth_mfa_factors f
   where f.id = p_factor_id and f.account_id = v_session.account_id
     and f.factor_type = 'totp' and f.state = 'pending' and f.disabled_at is null
     and f.created_at <= p_now and f.created_at > p_now - interval '10 minutes'
   for update;
  if v_factor_id is null then raise exception 'kova_auth_invalid_mfa_enrollment'; end if;
  if coalesce(array_ndims(p_recovery_digest_hexes), 0) <> 1
    or coalesce(cardinality(p_recovery_digest_hexes), 0) <> 8
    or (select count(distinct d) from unnest(p_recovery_digest_hexes) as codes(d)) <> 8 then
    raise exception 'kova_auth_invalid_recovery_codes';
  end if;
  foreach v_digest in array p_recovery_digest_hexes loop
    perform kova_private.require_digest(v_digest);
    if exists(select 1 from kova_private.auth_mfa_recovery_codes r
      where r.code_digest = kova_private.require_digest(v_digest)) then
      raise exception 'kova_auth_invalid_recovery_codes';
    end if;
  end loop;
  update kova_private.auth_mfa_factors set state = 'active', verified_at = p_now, updated_at = p_now
   where id = v_factor_id;
  update kova_private.auth_accounts set mfa_required = true, updated_at = p_now
   where id = v_session.account_id;
  delete from kova_private.auth_mfa_recovery_codes where account_id = v_session.account_id;
  foreach v_digest in array p_recovery_digest_hexes loop
    insert into kova_private.auth_mfa_recovery_codes(account_id, code_digest, created_at)
    values (v_session.account_id, kova_private.require_digest(v_digest), p_now);
  end loop;
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    'aal2', p_expires_at, 'mfa_enabled', jsonb_build_object('factor_id', v_factor_id), p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

create function public.kova_auth_remove_totp_with_session(
  p_session_digest_hex text, p_factor_id uuid, p_next_session_digest_hex text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_session kova_private.auth_sessions;
  v_next kova_private.auth_sessions;
  v_changed integer;
  v_required boolean;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if v_session.assurance_level <> 'aal2' then raise exception 'kova_auth_mfa_required'; end if;
  update kova_private.auth_mfa_factors set state = 'disabled', disabled_at = p_now, updated_at = p_now
   where id = p_factor_id and account_id = v_session.account_id and factor_type = 'totp'
     and state = 'active' and disabled_at is null and verified_at is not null;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'kova_auth_invalid_mfa_factor'; end if;
  select exists(select 1 from kova_private.auth_mfa_factors f where f.account_id = v_session.account_id
    and f.state = 'active' and f.disabled_at is null and f.verified_at is not null)
    or kova_private.legacy_mfa_required(v_session.account_id) into v_required;
  update kova_private.auth_accounts set mfa_required = v_required, updated_at = p_now
   where id = v_session.account_id;
  if not v_required then
    delete from kova_private.auth_mfa_recovery_codes where account_id = v_session.account_id;
  end if;
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    case when v_required then 'aal2' else 'aal1' end, p_expires_at,
    'mfa_removed', jsonb_build_object('factor_id', p_factor_id), p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

-- The old ABIs cannot rotate a cookie and are no longer application APIs.
-- Keep the definitions for historical migration tests, but deny runtime use.
revoke all on function public.kova_auth_activate_totp(text,uuid,text[],timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.kova_auth_remove_totp_factor(text,uuid,timestamptz)
  from public, anon, authenticated, service_role;

create function public.kova_auth_change_password(
  p_session_digest_hex text, p_credential_id uuid, p_credential_revision bigint,
  p_password_hash text, p_next_session_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_session kova_private.auth_sessions;
  v_next kova_private.auth_sessions;
  v_credential kova_private.auth_credentials;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if p_password_hash is null or char_length(p_password_hash) not between 64 and 2048
    or p_password_hash not like 'scrypt-v1$%' then
    raise exception 'kova_auth_invalid_password';
  end if;
  select * into v_credential from kova_private.auth_credentials c
   where c.id = p_credential_id and c.account_id = v_session.account_id
     and c.revision = p_credential_revision and c.credential_type = 'password'
     and c.activated_at is not null and c.disabled_at is null for update;
  if v_credential.id is null then raise exception 'kova_auth_stale_credential'; end if;
  update kova_private.auth_credentials set secret_hash = p_password_hash, algorithm = 'scrypt-v1',
    revision = revision + 1, updated_at = p_now where id = v_credential.id;
  update kova_private.auth_password_recoveries set consumed_at = p_now
   where account_id = v_session.account_id and consumed_at is null;
  update kova_private.auth_mfa_factors set state = 'disabled', disabled_at = p_now, updated_at = p_now
   where account_id = v_session.account_id and state = 'pending';
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    v_session.assurance_level, p_expires_at, 'password_changed', '{}'::jsonb, p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

-- A successful HTTP TOTP check does not authorize a factor/credential that was
-- disabled between the challenge read and the final transaction.
create or replace function public.kova_auth_finish_mfa_login(
  p_challenge_digest_hex text, p_token_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_account_id uuid;
  v_challenge kova_private.auth_mfa_login_challenges;
  v_account kova_private.auth_accounts;
  v_checked uuid;
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
  if v_account.id is null or v_account.deleted_at is not null or v_account.email_verified_at is null
    or not v_account.mfa_required
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  select c.id into v_checked from kova_private.auth_credentials c
   where c.id = v_challenge.credential_id and c.account_id = v_account.id
     and c.revision = v_challenge.credential_revision and c.credential_type = 'password'
     and c.activated_at is not null and c.disabled_at is null for share;
  if v_checked is null then raise exception 'kova_auth_account_unavailable'; end if;
  select f.id into v_checked from kova_private.auth_mfa_factors f
   where f.id = v_challenge.factor_id and f.account_id = v_account.id
     and f.factor_type = 'totp' and f.state = 'active'
     and f.verified_at is not null and f.disabled_at is null for share;
  if v_checked is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now where id = v_challenge.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_token_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'mfa_login', 'success',
    jsonb_build_object('factor_id', v_challenge.factor_id), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email, true, 'aal2'::text, p_expires_at;
end
$$;

create or replace function public.kova_auth_rotate_session(
  p_old_digest_hex text, p_new_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_old kova_private.auth_sessions; v_new_id uuid;
begin
  v_old := kova_private.lock_auth_session(p_old_digest_hex, p_now);
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at <= p_now
    or p_old_digest_hex = p_new_digest_hex then raise exception 'kova_auth_invalid_session'; end if;
  update kova_private.auth_sessions set revoked_at = p_now where id = v_old.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at,
    rotated_from, created_at, last_seen_at
  ) values (
    v_old.account_id, kova_private.require_digest(p_new_digest_hex), v_old.assurance_level,
    v_old.session_epoch, p_expires_at, v_old.id, p_now, p_now
  ) returning id into v_new_id;
  perform kova_private.audit(v_old.account_id, v_new_id, 'session_rotated', 'success', '{}', p_now);
  return query select v_new_id, a.id, a.primary_email, true, v_old.assurance_level, p_expires_at
    from kova_private.auth_accounts a where a.id = v_old.account_id;
end
$$;

revoke all on function public.kova_auth_activate_totp_with_session(text,uuid,text[],text,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.kova_auth_remove_totp_with_session(text,uuid,text,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.kova_auth_change_password(text,uuid,bigint,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_activate_totp_with_session(text,uuid,text[],text,timestamptz,timestamptz)
  to service_role;
grant execute on function public.kova_auth_remove_totp_with_session(text,uuid,text,timestamptz,timestamptz)
  to service_role;
grant execute on function public.kova_auth_change_password(text,uuid,bigint,text,text,timestamptz,timestamptz)
  to service_role;
