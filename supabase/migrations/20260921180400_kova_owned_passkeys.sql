-- Owned WebAuthn credentials. Only the server sees public-key material and
-- challenge receipts; browser roles cannot access this schema or these RPCs.
create table kova_private.auth_passkeys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  rp_id text not null check (char_length(rp_id) between 1 and 253),
  credential_id text not null unique check (
    char_length(credential_id) between 1 and 2048 and credential_id ~ '^[A-Za-z0-9_-]+$'
  ),
  public_key bytea not null check (octet_length(public_key) between 16 and 4096),
  user_handle text not null check (char_length(user_handle) between 1 and 128),
  sign_count bigint not null check (sign_count between 0 and 4294967295),
  revision bigint not null default 1 check (revision > 0),
  backup_eligible boolean not null,
  backed_up boolean not null,
  transports text[] not null default '{}',
  friendly_name text not null check (char_length(btrim(friendly_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  disabled_at timestamptz,
  check (not backed_up or backup_eligible)
);
create index auth_passkeys_account_idx on kova_private.auth_passkeys(account_id);

create table kova_private.auth_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  binding_digest bytea not null check (octet_length(binding_digest) = 32),
  purpose text not null check (purpose in ('registration', 'authentication')),
  rp_id text not null check (char_length(rp_id) between 1 and 253),
  expected_origin text not null check (char_length(expected_origin) between 9 and 1024),
  account_id uuid references kova_private.auth_accounts(id) on delete cascade,
  session_id uuid references kova_private.auth_sessions(id) on delete cascade,
  password_credential_id uuid references kova_private.auth_credentials(id) on delete cascade,
  password_revision bigint,
  friendly_name text,
  claim_digest bytea unique check (claim_digest is null or octet_length(claim_digest) = 32),
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check ((claim_digest is null) = (claimed_at is null)),
  check ((purpose = 'registration' and account_id is not null and session_id is not null
    and char_length(btrim(friendly_name)) between 1 and 120)
    or (purpose = 'authentication' and account_id is null and session_id is null
      and password_credential_id is null and password_revision is null and friendly_name is null)),
  check ((password_credential_id is null) = (password_revision is null))
);
create index auth_passkey_challenges_account_idx on kova_private.auth_passkey_challenges(account_id);
create index auth_passkey_challenges_session_idx on kova_private.auth_passkey_challenges(session_id);
create index auth_passkey_challenges_credential_idx on kova_private.auth_passkey_challenges(password_credential_id);
create index auth_passkey_challenges_expiry_idx on kova_private.auth_passkey_challenges(expires_at);
alter table kova_private.auth_passkeys enable row level security;
alter table kova_private.auth_passkey_challenges enable row level security;
revoke all on kova_private.auth_passkeys, kova_private.auth_passkey_challenges from public, anon, authenticated;

create function public.kova_auth_begin_passkey_challenge(
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
    -- AAL1 must re-prove the current password. An already MFA-verified AAL2
    -- session can register a key even for an OAuth-only account.
    if v_session.assurance_level <> 'aal2' or p_password_credential_id is not null then
      perform 1 from kova_private.auth_credentials c where c.id = p_password_credential_id
        and c.account_id = v_session.account_id and c.revision = p_password_revision
        and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null
        for share;
      if not found then raise exception 'kova_auth_reauthentication_required'; end if;
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

-- Claim once BEFORE cryptographic verification. A failed attempt burns this
-- challenge; completion needs the server-only receipt, never a browser flag.
create function public.kova_auth_claim_passkey_challenge(
  p_purpose text, p_challenge_digest_hex text, p_binding_digest_hex text,
  p_claim_digest_hex text, p_session_digest_hex text, p_now timestamptz default now()
) returns table(rp_id text, expected_origin text, account_id uuid, friendly_name text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions; v_challenge kova_private.auth_passkey_challenges;
begin
  if p_now is null or not isfinite(p_now) or p_purpose is null
    or p_purpose not in ('registration','authentication') then
    raise exception 'kova_auth_invalid_passkey_challenge';
  end if;
  if p_purpose = 'registration' then
    v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  elsif p_session_digest_hex is not null then
    raise exception 'kova_auth_invalid_passkey_challenge';
  end if;
  select * into v_challenge from kova_private.auth_passkey_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and c.binding_digest = kova_private.require_digest(p_binding_digest_hex)
     and c.purpose = p_purpose and c.claim_digest is null and c.consumed_at is null
     and c.created_at <= p_now and c.expires_at > p_now for update;
  if v_challenge.id is null or (p_purpose = 'registration' and
    (v_challenge.session_id <> v_session.id or v_challenge.account_id <> v_session.account_id)) then
    raise exception 'kova_auth_invalid_passkey_challenge';
  end if;
  update kova_private.auth_passkey_challenges set claim_digest = kova_private.require_digest(p_claim_digest_hex),
    claimed_at = p_now where id = v_challenge.id;
  return query select v_challenge.rp_id, v_challenge.expected_origin,
    v_challenge.account_id, v_challenge.friendly_name;
end
$$;

create function public.kova_auth_finish_passkey_registration(
  p_session_digest_hex text, p_challenge_digest_hex text, p_claim_digest_hex text,
  p_credential_id text, p_public_key_hex text, p_counter bigint,
  p_backup_eligible boolean, p_backed_up boolean, p_transports text[],
  p_next_session_digest_hex text, p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions; v_next kova_private.auth_sessions;
  v_challenge kova_private.auth_passkey_challenges; v_passkey_id uuid;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select * into v_challenge from kova_private.auth_passkey_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and c.claim_digest = kova_private.require_digest(p_claim_digest_hex)
     and c.purpose = 'registration' and c.account_id = v_session.account_id
     and c.session_id = v_session.id and c.consumed_at is null
     and c.claimed_at <= p_now and c.created_at <= p_now and c.expires_at > p_now for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_passkey_challenge'; end if;
  if v_challenge.password_credential_id is not null then
    perform 1 from kova_private.auth_credentials c where c.id = v_challenge.password_credential_id
      and c.account_id = v_session.account_id and c.revision = v_challenge.password_revision
      and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null for share;
    if not found then raise exception 'kova_auth_reauthentication_required'; end if;
  elsif v_session.assurance_level <> 'aal2' then
    raise exception 'kova_auth_reauthentication_required';
  end if;
  if p_public_key_hex is null or p_public_key_hex !~ '^[0-9a-f]+$'
    or char_length(p_public_key_hex) not between 32 and 8192
    or coalesce(cardinality(p_transports), 0) > 10
    or exists(select 1 from unnest(p_transports) t where t is null or
      t not in ('usb','nfc','ble','internal','hybrid','cable','smart-card')) then
    raise exception 'kova_auth_invalid_passkey_request';
  end if;
  if (select count(*) from kova_private.auth_passkeys k where k.account_id = v_session.account_id
      and k.disabled_at is null) >= 10 then raise exception 'kova_auth_passkey_limit'; end if;
  insert into kova_private.auth_passkeys(account_id, rp_id, credential_id, public_key, user_handle,
    sign_count, backup_eligible, backed_up, transports, friendly_name, created_at)
  values(v_session.account_id, v_challenge.rp_id, p_credential_id, decode(p_public_key_hex, 'hex'),
    rtrim(translate(encode(convert_to(v_session.account_id::text, 'utf8'), 'base64'), '+/', '-_'), '='),
    p_counter, p_backup_eligible, p_backed_up, coalesce(p_transports, '{}'), v_challenge.friendly_name, p_now)
  returning id into v_passkey_id;
  update kova_private.auth_passkey_challenges set consumed_at = p_now where id = v_challenge.id;
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    'aal2', p_expires_at, 'passkey_registered', jsonb_build_object('passkey_id', v_passkey_id), p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

create function public.kova_auth_lookup_passkey(p_credential_id text, p_now timestamptz default now())
returns table(passkey_id uuid, account_id uuid, rp_id text, credential_id text, public_key_hex text,
  user_handle text, sign_count bigint, revision bigint, session_epoch bigint, backup_eligible boolean)
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select k.id, k.account_id, k.rp_id, k.credential_id, encode(k.public_key, 'hex'), k.user_handle,
    k.sign_count, k.revision, a.session_epoch, k.backup_eligible
  from kova_private.auth_passkeys k join kova_private.auth_accounts a on a.id = k.account_id
  where k.credential_id = p_credential_id and k.disabled_at is null and k.created_at <= p_now
    and p_now is not null and isfinite(p_now) and a.deleted_at is null and a.email_verified_at is not null
    and (a.suspended_until is null or a.suspended_until <= p_now)
$$;

create function public.kova_auth_finish_passkey_login(
  p_challenge_digest_hex text, p_claim_digest_hex text, p_passkey_id uuid,
  p_revision bigint, p_expected_counter bigint, p_new_counter bigint, p_session_epoch bigint,
  p_user_handle text, p_backed_up boolean, p_session_digest_hex text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_account_id uuid; v_account kova_private.auth_accounts;
  v_key kova_private.auth_passkeys; v_challenge kova_private.auth_passkey_challenges; v_session_id uuid;
begin
  if p_now is null or not isfinite(p_now) or p_expires_at is null or not isfinite(p_expires_at)
    or p_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select k.account_id into v_account_id from kova_private.auth_passkeys k where k.id = p_passkey_id;
  select * into v_account from kova_private.auth_accounts a where a.id = v_account_id for update;
  if v_account.id is null or v_account.deleted_at is not null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_account.session_epoch is distinct from p_session_epoch then
    raise exception 'kova_auth_invalid_passkey_login';
  end if;
  select * into v_challenge from kova_private.auth_passkey_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and c.claim_digest = kova_private.require_digest(p_claim_digest_hex)
     and c.purpose = 'authentication' and c.consumed_at is null
     and c.claimed_at <= p_now and c.created_at <= p_now and c.expires_at > p_now for update;
  select * into v_key from kova_private.auth_passkeys k where k.id = p_passkey_id
    and k.account_id = v_account.id and k.disabled_at is null and k.created_at <= p_now for update;
  if v_challenge.id is null or v_key.id is null or v_key.rp_id is distinct from v_challenge.rp_id
    or v_key.revision is distinct from p_revision
    or v_key.sign_count is distinct from p_expected_counter or v_key.user_handle is distinct from p_user_handle
    or p_new_counter is null or p_new_counter not between 0 and 4294967295
    or ((v_key.sign_count > 0 or p_new_counter > 0) and p_new_counter <= v_key.sign_count)
    or p_backed_up is null or (p_backed_up and not v_key.backup_eligible) then
    raise exception 'kova_auth_invalid_passkey_login';
  end if;
  update kova_private.auth_passkeys set sign_count = p_new_counter, revision = revision + 1,
    backed_up = p_backed_up, last_used_at = p_now where id = v_key.id;
  update kova_private.auth_passkey_challenges set consumed_at = p_now where id = v_challenge.id;
  insert into kova_private.auth_sessions(account_id, token_digest, assurance_level,
    session_epoch, expires_at, created_at, last_seen_at)
  values(v_account.id, kova_private.require_digest(p_session_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, p_now, p_now) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'passkey_login', 'success',
    jsonb_build_object('passkey_id', v_key.id), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email, true, 'aal2'::text, p_expires_at;
end
$$;

create function public.kova_auth_list_passkeys(p_session_digest_hex text, p_now timestamptz default now())
returns table(id uuid, credential_id text, friendly_name text, created_at timestamptz, last_used_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  return query select k.id, k.credential_id, k.friendly_name, k.created_at, k.last_used_at
    from kova_private.auth_passkeys k where k.account_id = v_session.account_id and k.disabled_at is null
    order by k.created_at, k.id;
end
$$;

create function public.kova_auth_rename_passkey(
  p_session_digest_hex text, p_passkey_id uuid, p_friendly_name text, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions; v_changed integer;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if p_friendly_name is null or char_length(btrim(p_friendly_name)) not between 1 and 120 then
    raise exception 'kova_auth_invalid_passkey_request';
  end if;
  update kova_private.auth_passkeys set friendly_name = btrim(p_friendly_name)
    where id = p_passkey_id and account_id = v_session.account_id and disabled_at is null;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'kova_auth_invalid_passkey_request'; end if;
  perform kova_private.audit(v_session.account_id, v_session.id, 'passkey_renamed', 'success',
    jsonb_build_object('passkey_id', p_passkey_id), p_now);
  return true;
end
$$;

create function public.kova_auth_remove_passkey(
  p_session_digest_hex text, p_passkey_id uuid, p_next_session_digest_hex text,
  p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions; v_next kova_private.auth_sessions;
  v_remaining boolean; v_has_password boolean; v_has_totp boolean; v_requires_mfa boolean;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if v_session.assurance_level <> 'aal2' then raise exception 'kova_auth_reauthentication_required'; end if;
  perform 1 from kova_private.auth_passkeys where id = p_passkey_id
    and account_id = v_session.account_id and disabled_at is null for update;
  if not found then raise exception 'kova_auth_invalid_passkey_request'; end if;
  select exists(select 1 from kova_private.auth_passkeys k where k.account_id = v_session.account_id
    and k.id <> p_passkey_id and k.disabled_at is null) into v_remaining;
  select exists(select 1 from kova_private.auth_credentials c where c.account_id = v_session.account_id
    and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null) into v_has_password;
  select exists(select 1 from kova_private.auth_mfa_factors f where f.account_id = v_session.account_id
    and f.factor_type = 'totp' and f.state = 'active' and f.verified_at is not null and f.disabled_at is null)
    into v_has_totp;
  select a.mfa_required or kova_private.legacy_mfa_required(a.id) into v_requires_mfa
    from kova_private.auth_accounts a where a.id = v_session.account_id;
  -- Do not assume a configured/available external OAuth provider can rescue a
  -- user. Retain a demonstrably usable owned credential before removing the last key.
  if not v_remaining and not (v_has_password and (not v_requires_mfa or v_has_totp)) then
    raise exception 'kova_auth_last_sign_in_method';
  end if;
  update kova_private.auth_passkeys set disabled_at = p_now, revision = revision + 1 where id = p_passkey_id;
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    case when v_remaining or v_has_totp or v_requires_mfa then 'aal2' else 'aal1' end,
    p_expires_at, 'passkey_removed', jsonb_build_object('passkey_id', p_passkey_id), p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

revoke all on function public.kova_auth_begin_passkey_challenge(text,text,text,text,text,text,uuid,bigint,text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_claim_passkey_challenge(text,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_finish_passkey_registration(text,text,text,text,text,bigint,boolean,boolean,text[],text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_lookup_passkey(text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_finish_passkey_login(text,text,uuid,bigint,bigint,bigint,bigint,text,boolean,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_list_passkeys(text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_rename_passkey(text,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_remove_passkey(text,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.kova_auth_begin_passkey_challenge(text,text,text,text,text,text,uuid,bigint,text,timestamptz) to service_role;
grant execute on function public.kova_auth_claim_passkey_challenge(text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.kova_auth_finish_passkey_registration(text,text,text,text,text,bigint,boolean,boolean,text[],text,timestamptz,timestamptz) to service_role;
grant execute on function public.kova_auth_lookup_passkey(text,timestamptz) to service_role;
grant execute on function public.kova_auth_finish_passkey_login(text,text,uuid,bigint,bigint,bigint,bigint,text,boolean,text,timestamptz,timestamptz) to service_role;
grant execute on function public.kova_auth_list_passkeys(text,timestamptz) to service_role;
grant execute on function public.kova_auth_rename_passkey(text,uuid,text,timestamptz) to service_role;
grant execute on function public.kova_auth_remove_passkey(text,uuid,text,timestamptz,timestamptz) to service_role;
