-- Forward-only auth authority repairs. No application mode or deployment changes.
begin;

-- Hosted TOTP rows are no longer an authority after legacy sign-in retires.
create or replace function kova_private.legacy_mfa_required(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from kova_private.auth_legacy_retirements r
    where r.account_id = p_account_id)
    and exists(select 1 from auth.mfa_factors f
      where f.user_id = p_account_id and f.status = 'verified')
$$;

-- An audited primary sign-in on this exact session can authorize a first key.
-- Refresh, recovery, MFA rotation and elapsed session age cannot renew this proof.
create function kova_private.recent_primary_session(
  p_session_id uuid, p_account_id uuid, p_created_at timestamptz, p_now timestamptz
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_now is not null and isfinite(p_now) and exists(
    select 1 from kova_private.auth_audit_events e
     where e.session_id = p_session_id and e.account_id = p_account_id
       and e.outcome = 'success' and e.event_type in ('oauth_handoff_consumed', 'passkey_login')
       and e.occurred_at >= p_created_at
       and e.occurred_at > p_now - interval '5 minutes' and e.occurred_at <= p_now
  )
$$;
revoke all on function kova_private.recent_primary_session(uuid,uuid,timestamptz,timestamptz)
 from public, anon, authenticated, service_role;

create function public.kova_auth_passkey_recent_primary_session(
  p_session_digest_hex text, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  return kova_private.recent_primary_session(
    v_session.id, v_session.account_id, v_session.created_at, p_now
  );
end
$$;
revoke all on function public.kova_auth_passkey_recent_primary_session(text,timestamptz)
 from public, anon, authenticated;
grant execute on function public.kova_auth_passkey_recent_primary_session(text,timestamptz)
 to service_role;

create or replace function public.kova_auth_begin_passkey_challenge(
  p_purpose text, p_challenge_digest_hex text, p_binding_digest_hex text,
  p_rp_id text, p_origin text, p_session_digest_hex text,
  p_password_credential_id uuid, p_password_revision bigint, p_friendly_name text,
  p_now timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions;
begin
  if p_now is null or not isfinite(p_now) or p_purpose is null
    or p_purpose not in ('registration', 'authentication')
    or p_rp_id is null or p_rp_id !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or p_origin is null or p_origin !~ '^https://[^/]+$' then
    raise exception 'kova_auth_invalid_passkey_request';
  end if;
  if p_purpose = 'registration' then
    v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
    if p_friendly_name is null or char_length(btrim(p_friendly_name)) not between 1 and 120 then
      raise exception 'kova_auth_invalid_passkey_request';
    end if;
    -- Password confirmation, an MFA-verified session, or a recent audited
    -- primary sign-in on this exact session may authorize first enrollment.
    if p_password_credential_id is not null or p_password_revision is not null then
      perform 1 from kova_private.auth_credentials c where c.id = p_password_credential_id
        and c.account_id = v_session.account_id and c.revision = p_password_revision
        and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null
        for share;
      if not found then raise exception 'kova_auth_reauthentication_required'; end if;
    elsif v_session.assurance_level <> 'aal2' and not kova_private.recent_primary_session(
      v_session.id, v_session.account_id, v_session.created_at, p_now
    ) then
      raise exception 'kova_auth_reauthentication_required';
    end if;
    if (select count(*) from kova_private.auth_passkeys k where k.account_id = v_session.account_id
        and k.disabled_at is null) >= 10 then raise exception 'kova_auth_passkey_limit'; end if;
    update kova_private.auth_passkey_challenges set consumed_at = p_now
      where session_id = v_session.id and purpose = 'registration' and consumed_at is null;
  elsif p_session_digest_hex is not null or p_password_credential_id is not null
    or p_password_revision is not null or p_friendly_name is not null then
    raise exception 'kova_auth_invalid_passkey_request';
  end if;
  insert into kova_private.auth_passkey_challenges(token_digest, binding_digest, purpose,
    rp_id, expected_origin, account_id, session_id, password_credential_id, password_revision,
    friendly_name, created_at, expires_at)
  values(kova_private.require_digest(p_challenge_digest_hex), kova_private.require_digest(p_binding_digest_hex),
    p_purpose, p_rp_id, p_origin, v_session.account_id, v_session.id,
    p_password_credential_id, p_password_revision, p_friendly_name, p_now, p_now + interval '5 minutes');
  return true;
end
$$;

create or replace function public.kova_auth_activate_totp_with_session(
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
  v_legacy uuid;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select f.id into v_factor_id from kova_private.auth_mfa_factors f
   where f.id = p_factor_id and f.account_id = v_session.account_id
     and f.factor_type = 'totp' and f.state = 'pending' and f.disabled_at is null
     and f.created_at <= p_now and f.created_at > p_now - interval '10 minutes'
     and f.enrollment_session_id = v_session.id and f.enrollment_epoch = v_session.session_epoch
     and f.enrollment_authorized_at <= p_now
     and f.enrollment_authorized_at > p_now - interval '5 minutes'
     and (f.enrollment_method in ('primary_session', 'existing_mfa')
       or (f.enrollment_method = 'password' and exists(select 1 from kova_private.auth_credentials c
         where c.id = f.enrollment_credential_id and c.account_id = v_session.account_id
           and c.revision = f.enrollment_credential_revision
           and c.activated_at is not null and c.disabled_at is null)))
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
  select legacy_supabase_user_id into v_legacy from kova_private.auth_accounts
    where id = v_session.account_id;
  if v_legacy is not null then
    perform kova_private.retire_legacy_auth(v_legacy, p_now);
  end if;
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

create or replace function public.kova_auth_finalize_account_deletion(p_account_id uuid, p_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare v_account kova_private.auth_accounts; v_session kova_private.auth_sessions;
begin
  if p_account_id is null or p_session_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 20260903204500));
  select * into v_account from kova_private.auth_accounts where id = p_account_id for update;
  if not found then
    return not exists(select 1 from auth.users where id = p_account_id);
  end if;
  if v_account.legacy_supabase_user_id is distinct from p_account_id or
     v_account.deleted_at is not null or v_account.email_verified_at is null or
     (v_account.suspended_until is not null and v_account.suspended_until > now()) or
     not exists(select 1 from public.account_deletion_fences f
       where f.user_id = p_account_id and f.started_at is not null) then return false; end if;
  select * into v_session from kova_private.auth_sessions s
    where s.id = p_session_id and s.account_id = p_account_id for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() or
     v_session.session_epoch is distinct from v_account.session_epoch or
     ((v_account.mfa_required or kova_private.legacy_mfa_required(p_account_id))
       and v_session.assurance_level <> 'aal2') or
     not exists(select 1 from kova_private.auth_identities i
       where i.account_id = p_account_id and i.verified_at is not null and i.disabled_at is null
         and i.normalized_email = v_account.primary_email) then return false; end if;
  -- Keep the denial marker after the cascading owned-account erasure.
  perform kova_private.retire_legacy_auth(p_account_id, now());
  delete from auth.users where id = p_account_id;
  if not found or exists(select 1 from kova_private.auth_accounts where id = p_account_id) then
    raise exception 'kova_auth_account_deletion_incomplete';
  end if;
  return true;
end
$$;
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
         -- The raw hosted factor remains cutover evidence even after hosted
         -- sign-in is retired, unless a verified owned factor was explicitly
         -- removed by the user and the owned MFA requirement is now clear.
         and exists(select 1 from auth.mfa_factors hosted
           where hosted.user_id = a.legacy_supabase_user_id and hosted.status = 'verified')
         and not exists(select 1 from kova_private.auth_audit_events e
           where e.account_id = a.id and e.event_type = 'mfa_removed'
             and e.outcome = 'success' and e.occurred_at <= p_now
             and exists(select 1 from kova_private.auth_legacy_retirements r
               where r.account_id = a.legacy_supabase_user_id
                 and r.retired_at <= e.occurred_at))
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

-- Newly active owned MFA must revoke any surviving hosted AAL1 authority.
-- Repair already active factor accounts atomically when this migration applies.
insert into kova_private.auth_legacy_retirements(account_id, retired_at)
 select distinct a.legacy_supabase_user_id, now()
 from kova_private.auth_accounts a
 join kova_private.auth_mfa_factors f on f.account_id = a.id
 where a.legacy_supabase_user_id is not null and a.mfa_required
   and f.state = 'active' and f.verified_at is not null and f.disabled_at is null
 on conflict(account_id) do nothing;
update auth.users u set encrypted_password = null, updated_at = now()
 where exists(select 1 from kova_private.auth_accounts a
   join kova_private.auth_mfa_factors f on f.account_id = a.id
   where a.legacy_supabase_user_id = u.id and a.mfa_required
     and f.state = 'active' and f.verified_at is not null and f.disabled_at is null)
 and u.encrypted_password is not null;
delete from auth.sessions s
 where exists(select 1 from kova_private.auth_accounts a
   join kova_private.auth_mfa_factors f on f.account_id = a.id
   where a.legacy_supabase_user_id = s.user_id and a.mfa_required
     and f.state = 'active' and f.verified_at is not null and f.disabled_at is null);

commit;
