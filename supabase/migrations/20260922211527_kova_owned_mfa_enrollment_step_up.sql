-- Reauthentication is checked before returning a first MFA secret. The
-- authority is a freshly checked password or a recent, server-audited Google
-- OAuth/passkey sign-in on this exact session, never its age or AAL alone.
-- No provider configuration or deployed application is changed here.

alter table kova_private.auth_mfa_factors
  add column enrollment_session_id uuid references kova_private.auth_sessions(id) on delete set null,
  add column enrollment_epoch bigint,
  add column enrollment_authorized_at timestamptz,
  add column enrollment_credential_id uuid references kova_private.auth_credentials(id) on delete set null,
  add column enrollment_credential_revision bigint,
  add column enrollment_method text check (enrollment_method in ('password', 'primary_session', 'existing_mfa'));
create index auth_mfa_enrollment_session_idx on kova_private.auth_mfa_factors(enrollment_session_id)
 where enrollment_session_id is not null;
create index auth_mfa_enrollment_credential_idx on kova_private.auth_mfa_factors(enrollment_credential_id)
 where enrollment_credential_id is not null;
-- Never grandfather a pending setup created without the new authorization.
update kova_private.auth_mfa_factors
 set state = 'disabled', disabled_at = greatest(now(), created_at), updated_at = greatest(now(), created_at)
 where state = 'pending' and disabled_at is null;

create function public.kova_auth_begin_totp_enrollment_reauthenticated(
  p_session_digest_hex text, p_secret_envelope text, p_friendly_name text,
  p_credential_id uuid default null, p_credential_revision bigint default null,
  p_now timestamptz default now()
) returns table(factor_id uuid, email text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_session kova_private.auth_sessions; v_factor_id uuid; v_email text;
  v_checked uuid; v_method text;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if p_secret_envelope is null or char_length(p_secret_envelope) not between 16 and 4096
    or p_friendly_name is null or char_length(p_friendly_name) not between 1 and 120 then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  if exists(select 1 from kova_private.auth_mfa_factors f
    where f.account_id = v_session.account_id and f.state = 'active'
      and f.disabled_at is null and f.verified_at is not null) then
    if v_session.assurance_level <> 'aal2' then
      raise exception 'kova_auth_reauthentication_required' using errcode = '42501';
    end if;
    v_method := 'existing_mfa';
  elsif p_credential_id is not null or p_credential_revision is not null then
    -- Only the server may attest this pair after checking the actual password.
    -- Recheck under the same account lock to reject a password-change race.
    select c.id into v_checked from kova_private.auth_credentials c
     where c.id = p_credential_id and c.account_id = v_session.account_id
       and c.revision = p_credential_revision and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null for share;
    if v_checked is null then
      raise exception 'kova_auth_reauthentication_required' using errcode = '42501';
    end if;
    v_method := 'password';
  elsif exists(select 1 from kova_private.auth_audit_events e
    where e.account_id = v_session.account_id and e.session_id = v_session.id
      and e.outcome = 'success' and e.event_type in ('oauth_handoff_consumed', 'passkey_login')
      and e.occurred_at > p_now - interval '5 minutes' and e.occurred_at <= p_now
      and e.occurred_at >= v_session.created_at) then
    -- A rotation, refresh, recovery, or MFA activation event is not primary
    -- reauthentication and cannot refresh this five-minute authorization.
    v_method := 'primary_session';
  else
    raise exception 'kova_auth_reauthentication_required' using errcode = '42501';
  end if;
  select r.factor_id, r.email into v_factor_id, v_email
    from public.kova_auth_begin_totp_enrollment(p_session_digest_hex, p_secret_envelope, p_friendly_name, p_now) r;
  update kova_private.auth_mfa_factors set enrollment_session_id = v_session.id,
    enrollment_epoch = v_session.session_epoch, enrollment_authorized_at = p_now,
    enrollment_method = v_method,
    enrollment_credential_id = case when v_method = 'password' then p_credential_id else null end,
    enrollment_credential_revision = case when v_method = 'password' then p_credential_revision else null end
   where id = v_factor_id;
  return query select v_factor_id, v_email;
end
$$;
revoke all on function public.kova_auth_begin_totp_enrollment(text,text,text,timestamptz)
 from public, anon, authenticated, service_role;
revoke all on function public.kova_auth_begin_totp_enrollment_reauthenticated(text,text,text,uuid,bigint,timestamptz)
 from public, anon, authenticated;
grant execute on function public.kova_auth_begin_totp_enrollment_reauthenticated(text,text,text,uuid,bigint,timestamptz)
 to service_role;

create or replace function public.kova_auth_read_totp_enrollment(
  p_session_digest_hex text, p_factor_id uuid, p_now timestamptz default now()
) returns table(factor_id uuid, secret_envelope text)
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select f.id, convert_from(f.secret_ciphertext, 'utf8')
    from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
    join kova_private.auth_mfa_factors f on f.account_id = a.id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and f.id = p_factor_id and f.factor_type = 'totp'
     and f.state = 'pending' and f.disabled_at is null
     and a.email_verified_at is not null
     and (a.suspended_until is null or a.suspended_until <= p_now)
     and f.enrollment_session_id = s.id and f.enrollment_epoch = a.session_epoch
     and f.enrollment_authorized_at <= p_now
     and f.enrollment_authorized_at > p_now - interval '5 minutes'
     and (f.enrollment_method in ('primary_session', 'existing_mfa')
       or (f.enrollment_method = 'password' and exists(select 1 from kova_private.auth_credentials c
         where c.id = f.enrollment_credential_id and c.account_id = a.id
           and c.revision = f.enrollment_credential_revision
           and c.activated_at is not null and c.disabled_at is null)))
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
