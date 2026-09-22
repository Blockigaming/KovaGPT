-- Kova-owned identity, credential, challenge, MFA, OAuth, audit, and
-- server-session store. The migration remains dormant until KOVA_AUTH_MODE is
-- enabled in a separately approved environment.

create schema if not exists kova_private;
revoke all on schema kova_private from public, anon, authenticated;

create table kova_private.auth_accounts (
  id uuid primary key,
  legacy_supabase_user_id uuid unique references auth.users(id) on delete cascade,
  primary_email text not null unique check (
    primary_email = lower(btrim(primary_email)) and char_length(primary_email) between 3 and 320
  ),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  email_verified_at timestamptz,
  suspended_until timestamptz,
  deleted_at timestamptz,
  mfa_required boolean not null default false,
  session_epoch bigint not null default 0 check (session_epoch >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_accounts_stable_legacy_uuid
    check (legacy_supabase_user_id is null or legacy_supabase_user_id = id)
);

comment on column kova_private.auth_accounts.id is
  'Durable application account UUID; migrated accounts retain their Supabase Auth UUID.';

create table kova_private.auth_identities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  provider text not null check (provider in ('email', 'google')),
  provider_subject text not null check (char_length(provider_subject) between 1 and 512),
  normalized_email text check (
    normalized_email is null or
    (normalized_email = lower(btrim(normalized_email)) and char_length(normalized_email) between 3 and 320)
  ),
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject),
  unique (account_id, provider)
);

create unique index auth_email_identity_unique
  on kova_private.auth_identities (normalized_email)
  where provider = 'email' and disabled_at is null;

create table kova_private.auth_credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  credential_type text not null check (credential_type = 'password'),
  secret_hash text not null check (char_length(secret_hash) between 64 and 2048),
  algorithm text not null check (algorithm = 'scrypt-v1'),
  revision bigint not null default 1 check (revision > 0),
  activated_at timestamptz,
  disabled_at timestamptz,
  legacy_disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index auth_active_password_credential
  on kova_private.auth_credentials (account_id)
  where credential_type = 'password' and disabled_at is null;

create table kova_private.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  assurance_level text not null check (assurance_level in ('aal1', 'aal2')),
  session_epoch bigint not null check (session_epoch >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid unique references kova_private.auth_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at),
  check (last_seen_at >= created_at)
);

create index auth_sessions_account_active_idx
  on kova_private.auth_sessions (account_id, expires_at)
  where revoked_at is null;

create table kova_private.auth_email_verifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  identity_id uuid not null references kova_private.auth_identities(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index auth_email_verifications_pending_idx
  on kova_private.auth_email_verifications (account_id, expires_at)
  where consumed_at is null;

create table kova_private.auth_password_recoveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index auth_password_recoveries_pending_idx
  on kova_private.auth_password_recoveries (account_id, expires_at)
  where consumed_at is null;

create table kova_private.auth_mfa_factors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  factor_type text not null check (factor_type in ('totp', 'webauthn')),
  state text not null check (state in ('pending', 'active', 'disabled')),
  friendly_name text check (friendly_name is null or char_length(friendly_name) between 1 and 120),
  secret_ciphertext bytea,
  public_key jsonb,
  sign_count bigint not null default 0 check (sign_count >= 0),
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (factor_type = 'totp' and secret_ciphertext is not null and public_key is null) or
    (factor_type = 'webauthn' and public_key is not null and secret_ciphertext is null)
  )
);

create index auth_mfa_factors_account_idx
  on kova_private.auth_mfa_factors (account_id, state);

create table kova_private.auth_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  code_digest bytea not null unique check (octet_length(code_digest) = 32),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table kova_private.auth_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_digest bytea not null unique check (octet_length(state_digest) = 32),
  nonce_digest bytea not null check (octet_length(nonce_digest) = 32),
  pkce_verifier_ciphertext text not null check (char_length(pkce_verifier_ciphertext) between 32 and 4096),
  return_to text not null check (char_length(return_to) between 1 and 1024),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create table kova_private.auth_session_handoffs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  assurance_level text not null check (assurance_level in ('aal1', 'aal2')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create table kova_private.auth_audit_events (
  id bigint generated always as identity primary key,
  account_id uuid references kova_private.auth_accounts(id) on delete set null,
  session_id uuid references kova_private.auth_sessions(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  outcome text not null check (outcome in ('success', 'rejected', 'error')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index auth_audit_account_time_idx
  on kova_private.auth_audit_events (account_id, occurred_at desc);

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'auth_accounts', 'auth_identities', 'auth_credentials', 'auth_sessions',
    'auth_email_verifications', 'auth_password_recoveries', 'auth_mfa_factors',
    'auth_mfa_recovery_codes', 'auth_oauth_states', 'auth_session_handoffs',
    'auth_audit_events'
  ] loop
    execute format('alter table kova_private.%I enable row level security', relation_name);
    execute format('revoke all on table kova_private.%I from public, anon, authenticated', relation_name);
  end loop;
end
$$;

create function kova_private.require_digest(p_digest_hex text) returns bytea
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_digest_hex is null or p_digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'kova_auth_invalid_digest';
  end if;
  return decode(p_digest_hex, 'hex');
end
$$;

create function kova_private.audit(
  p_account_id uuid, p_session_id uuid, p_event_type text, p_outcome text,
  p_metadata jsonb default '{}'::jsonb, p_now timestamptz default now()
) returns void language sql volatile security definer set search_path = '' as $$
  insert into kova_private.auth_audit_events(
    account_id, session_id, event_type, outcome, metadata, occurred_at
  ) values (
    p_account_id, p_session_id, p_event_type, p_outcome,
    coalesce(p_metadata, '{}'::jsonb), p_now
  )
$$;

create function kova_private.legacy_mfa_required(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from auth.mfa_factors f
     where f.user_id = p_account_id and f.status = 'verified'
  )
$$;

create function public.kova_auth_create_password_account(
  p_candidate_account_id uuid, p_email text, p_display_name text,
  p_password_hash text, p_verification_digest_hex text,
  p_verification_expires_at timestamptz, p_email_payload jsonb,
  p_now timestamptz default now()
) returns table(account_id uuid, candidate_used boolean, verification_created boolean)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email));
  v_account_id uuid; v_legacy_id uuid; v_identity_id uuid;
  v_existing_active boolean; v_existing_pending boolean;
begin
  if p_candidate_account_id is null or char_length(v_email) not between 3 and 320 or
     v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
     char_length(p_password_hash) not between 64 and 2048 or
     p_verification_expires_at <= p_now or p_email_payload is null or
     jsonb_typeof(p_email_payload) <> 'object' then
    raise exception 'kova_auth_invalid_signup';
  end if;
  perform kova_private.require_digest(p_verification_digest_hex);

  select i.account_id into v_account_id from kova_private.auth_identities i
   where i.provider = 'email' and i.normalized_email = v_email and i.disabled_at is null for update;
  if v_account_id is null then
    -- A Google-created Kova account already owns its provider-verified email.
    -- Reuse that stable account UUID and add an email identity rather than
    -- failing the auth_accounts primary_email uniqueness constraint.
    select i.account_id into v_account_id from kova_private.auth_identities i
     where i.normalized_email = v_email and i.verified_at is not null and i.disabled_at is null
     order by (i.provider = 'email') desc, i.created_at asc, i.id asc limit 1 for update;
    if v_account_id is null then
      select u.id into v_legacy_id from auth.users u
       where lower(u.email) = v_email and u.deleted_at is null
       order by u.created_at asc nulls last, u.id limit 1;
      v_account_id := coalesce(v_legacy_id, p_candidate_account_id);
    end if;
    insert into kova_private.auth_accounts(
      id, legacy_supabase_user_id, primary_email, display_name, mfa_required, created_at, updated_at
    ) values (
      v_account_id, v_account_id, v_email, nullif(btrim(p_display_name), ''),
      kova_private.legacy_mfa_required(v_account_id),
      p_now, p_now
    ) on conflict (id) do update set
      mfa_required = kova_private.auth_accounts.mfa_required or excluded.mfa_required,
      updated_at = excluded.updated_at;
    insert into kova_private.auth_identities(
      account_id, provider, provider_subject, normalized_email, created_at, updated_at
    ) values (v_account_id, 'email', v_email, v_email, p_now, p_now)
    on conflict (provider, provider_subject) do update set updated_at = excluded.updated_at
    returning id, account_id into v_identity_id, v_account_id;
  else
    select id into v_identity_id from kova_private.auth_identities
     where provider = 'email' and normalized_email = v_email and disabled_at is null;
  end if;

  update kova_private.auth_accounts set
    mfa_required = mfa_required or kova_private.legacy_mfa_required(v_account_id),
    updated_at = p_now
   where id = v_account_id;

  select exists(select 1 from kova_private.auth_credentials c
    where c.account_id = v_account_id and c.credential_type = 'password'
      and c.activated_at is not null and c.disabled_at is null) into v_existing_active;
  if v_existing_active then
    perform kova_private.audit(v_account_id, null, 'signup_existing_account', 'rejected', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, false;
    return;
  end if;
  select exists(select 1 from kova_private.auth_credentials c
    where c.account_id = v_account_id and c.credential_type = 'password'
      and c.activated_at is null and c.disabled_at is null) into v_existing_pending;
  if v_existing_pending then
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'accepted', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, false;
    return;
  end if;

  insert into kova_private.auth_credentials(
    account_id, credential_type, secret_hash, algorithm, activated_at, created_at, updated_at
  ) values (v_account_id, 'password', p_password_hash, 'scrypt-v1', null, p_now, p_now)
  on conflict (account_id) where credential_type = 'password' and disabled_at is null do nothing;
  if not found then
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'accepted', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, false;
    return;
  end if;
  update kova_private.auth_email_verifications set consumed_at = p_now
   where account_id = v_account_id and consumed_at is null;
  insert into kova_private.auth_email_verifications(
    account_id, identity_id, token_digest, expires_at, created_at
  ) values (
    v_account_id, v_identity_id, kova_private.require_digest(p_verification_digest_hex),
    p_verification_expires_at, p_now
  );
  perform public.enqueue_email('auth_emails', p_email_payload);
  perform kova_private.audit(v_account_id, null, 'signup_verification_queued', 'success', '{}', p_now);
  return query select v_account_id, v_account_id = p_candidate_account_id, true;
end
$$;

create function public.kova_auth_consume_verification(
  p_verification_digest_hex text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_challenge kova_private.auth_email_verifications;
  v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if p_session_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_challenge from kova_private.auth_email_verifications
   where token_digest = kova_private.require_digest(p_verification_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_verification'; end if;
  update kova_private.auth_email_verifications set consumed_at = p_now where id = v_challenge.id;
  update kova_private.auth_accounts set
    email_verified_at = coalesce(email_verified_at, p_now), updated_at = p_now
   where id = v_challenge.account_id returning * into v_account;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  update kova_private.auth_identities set verified_at = coalesce(verified_at, p_now), updated_at = p_now
   where id = v_challenge.identity_id;
  update kova_private.auth_credentials set activated_at = coalesce(activated_at, p_now), updated_at = p_now
   where account_id = v_account.id and credential_type = 'password' and disabled_at is null;
  update kova_private.auth_email_verifications set consumed_at = p_now
   where account_id = v_account.id and consumed_at is null;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_session_digest_hex), 'aal1',
    v_account.session_epoch, p_session_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'email_verified', 'success', '{}', p_now);
  return query select v_account.id, v_session_id, v_account.primary_email,
    true, 'aal1'::text, p_session_expires_at;
end
$$;

create function public.kova_auth_password_lookup(p_email text, p_now timestamptz default now())
returns table(
  account_id uuid, credential_id uuid, credential_revision bigint,
  password_hash text, email text, display_name text, mfa_required boolean
) language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select a.id, c.id, c.revision, c.secret_hash, a.primary_email, a.display_name,
    a.mfa_required or kova_private.legacy_mfa_required(a.id)
    from kova_private.auth_accounts a join kova_private.auth_credentials c on c.account_id = a.id
   where a.primary_email = lower(btrim(p_email)) and a.email_verified_at is not null
     and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
     and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null
$$;

create function public.kova_auth_create_session(
  p_account_id uuid, p_credential_id uuid, p_credential_revision bigint,
  p_token_digest_hex text, p_assurance_level text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(
  session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if p_assurance_level not in ('aal1', 'aal2') or p_expires_at <= p_now then
    raise exception 'kova_auth_invalid_session';
  end if;
  select * into v_account from kova_private.auth_accounts where id = p_account_id for update;
  if v_account.id is null or v_account.email_verified_at is null or v_account.deleted_at is not null or
     (v_account.suspended_until is not null and v_account.suspended_until > p_now) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  if (v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id)) and
     p_assurance_level <> 'aal2' then raise exception 'kova_auth_mfa_required'; end if;
  if not exists(select 1 from kova_private.auth_credentials c
    where c.id = p_credential_id and c.account_id = p_account_id
      and c.revision = p_credential_revision and c.credential_type = 'password'
      and c.activated_at is not null and c.disabled_at is null) then
    raise exception 'kova_auth_stale_credential';
  end if;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    p_account_id, kova_private.require_digest(p_token_digest_hex), p_assurance_level,
    v_account.session_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(p_account_id, v_session_id, 'password_login', 'success', '{}', p_now);
  return query select v_session_id, v_account.id, v_account.primary_email,
    true, p_assurance_level, p_expires_at;
end
$$;

create function public.kova_auth_resolve_session(p_token_digest_hex text, p_now timestamptz default now())
returns table(
  session_id uuid, account_id uuid, email text, display_name text,
  email_verified boolean, assurance_level text, expires_at timestamptz
) language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select s.id, a.id, a.primary_email, a.display_name, a.email_verified_at is not null,
    s.assurance_level, s.expires_at
    from kova_private.auth_sessions s join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_token_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
     and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id)) or s.assurance_level = 'aal2')
$$;

create function public.kova_auth_rotate_session(
  p_old_digest_hex text, p_new_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(
  session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_old kova_private.auth_sessions; v_account kova_private.auth_accounts; v_new_id uuid;
begin
  if p_old_digest_hex = p_new_digest_hex or p_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select s.* into v_old from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_old_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
     and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id)) or
       s.assurance_level = 'aal2') for update of s;
  if v_old.id is null then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_account from kova_private.auth_accounts where id = v_old.account_id;
  update kova_private.auth_sessions set revoked_at = p_now where id = v_old.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at,
    rotated_from, created_at, last_seen_at
  ) values (
    v_old.account_id, kova_private.require_digest(p_new_digest_hex), v_old.assurance_level,
    v_old.session_epoch, p_expires_at, v_old.id, p_now, p_now
  ) returning id into v_new_id;
  perform kova_private.audit(v_old.account_id, v_new_id, 'session_rotated', 'success', '{}', p_now);
  return query select v_new_id, v_account.id, v_account.primary_email,
    v_account.email_verified_at is not null, v_old.assurance_level, p_expires_at;
end
$$;

create function public.kova_auth_revoke_session(p_token_digest_hex text, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions;
begin
  update kova_private.auth_sessions set revoked_at = coalesce(revoked_at, p_now)
   where token_digest = kova_private.require_digest(p_token_digest_hex) returning * into v_session;
  if v_session.id is null then return false; end if;
  perform kova_private.audit(v_session.account_id, v_session.id, 'session_revoked', 'success', '{}', p_now);
  return true;
end
$$;

create function public.kova_auth_create_recovery(
  p_email text, p_recovery_digest_hex text, p_recovery_expires_at timestamptz,
  p_email_payload jsonb, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare v_email text := lower(btrim(p_email)); v_account_id uuid; v_legacy_id uuid;
begin
  if p_recovery_expires_at <= p_now or p_email_payload is null or
     jsonb_typeof(p_email_payload) <> 'object' then
    raise exception 'kova_auth_invalid_recovery';
  end if;
  perform kova_private.require_digest(p_recovery_digest_hex);
  select account_id into v_account_id from kova_private.auth_identities
   where normalized_email = v_email and verified_at is not null and disabled_at is null
   order by provider = 'email' desc limit 1;
  if v_account_id is null then
    select u.id into v_legacy_id from auth.users u
     where lower(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null
     order by u.created_at asc nulls last, u.id limit 1;
    if v_legacy_id is not null then
      v_account_id := v_legacy_id;
      insert into kova_private.auth_accounts(
        id, legacy_supabase_user_id, primary_email, email_verified_at,
        mfa_required, created_at, updated_at
      ) values (
        v_account_id, v_account_id, v_email, p_now,
        kova_private.legacy_mfa_required(v_account_id),
        p_now, p_now
      )
      on conflict (id) do update set
        email_verified_at = coalesce(kova_private.auth_accounts.email_verified_at, excluded.email_verified_at),
        mfa_required = kova_private.auth_accounts.mfa_required or excluded.mfa_required,
        updated_at = excluded.updated_at;
      insert into kova_private.auth_identities(
        account_id, provider, provider_subject, normalized_email, verified_at, created_at, updated_at
      ) values (v_account_id, 'email', v_email, v_email, p_now, p_now, p_now)
      on conflict (provider, provider_subject) do update set
        verified_at = coalesce(kova_private.auth_identities.verified_at, excluded.verified_at),
        updated_at = excluded.updated_at;
    end if;
  end if;
  if v_account_id is null then return false; end if;
  update kova_private.auth_accounts set
    mfa_required = mfa_required or kova_private.legacy_mfa_required(v_account_id),
    updated_at = p_now
   where id = v_account_id;
  update kova_private.auth_password_recoveries set consumed_at = p_now
   where account_id = v_account_id and consumed_at is null;
  insert into kova_private.auth_password_recoveries(account_id, token_digest, expires_at, created_at)
  values (v_account_id, kova_private.require_digest(p_recovery_digest_hex), p_recovery_expires_at, p_now);
  perform public.enqueue_email('auth_emails', p_email_payload);
  perform kova_private.audit(v_account_id, null, 'password_recovery_queued', 'success', '{}', p_now);
  return true;
end
$$;

create function public.kova_auth_recovery_target(p_recovery_digest_hex text, p_now timestamptz default now())
returns uuid language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select account_id from kova_private.auth_password_recoveries
   where token_digest = kova_private.require_digest(p_recovery_digest_hex)
     and consumed_at is null and expires_at > p_now
$$;

create function public.kova_auth_consume_recovery(
  p_recovery_digest_hex text, p_password_hash text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_recovery kova_private.auth_password_recoveries;
  v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if char_length(p_password_hash) not between 64 and 2048 or p_session_expires_at <= p_now then
    raise exception 'kova_auth_invalid_recovery';
  end if;
  select * into v_recovery from kova_private.auth_password_recoveries
   where token_digest = kova_private.require_digest(p_recovery_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_recovery.id is null then raise exception 'kova_auth_invalid_recovery'; end if;
  select * into v_account from kova_private.auth_accounts
   where id = v_recovery.account_id and deleted_at is null for update;
  if v_account.id is null then raise exception 'kova_auth_account_unavailable'; end if;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  insert into kova_private.auth_credentials(
    account_id, credential_type, secret_hash, algorithm, activated_at,
    legacy_disabled_at, created_at, updated_at
  ) values (v_account.id, 'password', p_password_hash, 'scrypt-v1', p_now, p_now, p_now, p_now)
  on conflict (account_id) where credential_type = 'password' and disabled_at is null do update set
    secret_hash = excluded.secret_hash, algorithm = excluded.algorithm,
    revision = kova_private.auth_credentials.revision + 1,
    activated_at = excluded.activated_at, legacy_disabled_at = excluded.legacy_disabled_at,
    updated_at = excluded.updated_at;
  update kova_private.auth_password_recoveries set consumed_at = p_now
   where account_id = v_account.id and consumed_at is null;
  update kova_private.auth_accounts set
    email_verified_at = coalesce(email_verified_at, p_now),
    session_epoch = session_epoch + 1, updated_at = p_now
   where id = v_account.id returning * into v_account;
  update kova_private.auth_sessions set revoked_at = coalesce(revoked_at, p_now)
   where account_id = v_account.id and revoked_at is null;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_session_digest_hex), 'aal1',
    v_account.session_epoch, p_session_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'password_recovered', 'success', '{}', p_now);
  return query select v_account.id, v_session_id, v_account.primary_email,
    true, 'aal1'::text, p_session_expires_at;
end
$$;

create function public.kova_auth_create_oauth_state(
  p_state_digest_hex text, p_nonce_digest_hex text, p_pkce_verifier_ciphertext text,
  p_return_to text, p_expires_at timestamptz, p_now timestamptz default now()
) returns uuid language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_id uuid;
begin
  if char_length(p_pkce_verifier_ciphertext) not between 32 and 4096 or
     char_length(p_return_to) not between 1 and 1024 or p_expires_at <= p_now then
    raise exception 'kova_auth_invalid_oauth_state';
  end if;
  insert into kova_private.auth_oauth_states(
    state_digest, nonce_digest, pkce_verifier_ciphertext, return_to, expires_at, created_at
  ) values (
    kova_private.require_digest(p_state_digest_hex), kova_private.require_digest(p_nonce_digest_hex),
    p_pkce_verifier_ciphertext, p_return_to, p_expires_at, p_now
  ) returning id into v_id;
  return v_id;
end
$$;

create function public.kova_auth_consume_oauth_state(p_state_digest_hex text, p_now timestamptz default now())
returns table(nonce_digest_hex text, pkce_verifier_ciphertext text, return_to text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_state kova_private.auth_oauth_states;
begin
  select * into v_state from kova_private.auth_oauth_states
   where state_digest = kova_private.require_digest(p_state_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_state.id is null then raise exception 'kova_auth_invalid_oauth_state'; end if;
  update kova_private.auth_oauth_states set consumed_at = p_now where id = v_state.id;
  return query select encode(v_state.nonce_digest, 'hex'),
    v_state.pkce_verifier_ciphertext, v_state.return_to;
end
$$;

create function public.kova_auth_finish_google(
  p_candidate_account_id uuid, p_provider_subject text, p_email text,
  p_email_verified boolean, p_display_name text, p_handoff_digest_hex text,
  p_handoff_expires_at timestamptz, p_now timestamptz default now()
) returns table(account_id uuid, candidate_used boolean)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email)); v_account_id uuid; v_bound_id uuid; v_legacy_id uuid;
begin
  if p_candidate_account_id is null or not p_email_verified or
     char_length(p_provider_subject) not between 1 and 512 or
     char_length(v_email) not between 3 and 320 or p_handoff_expires_at <= p_now then
    raise exception 'kova_auth_invalid_google_identity';
  end if;
  perform kova_private.require_digest(p_handoff_digest_hex);
  select account_id into v_account_id from kova_private.auth_identities
   where provider = 'google' and provider_subject = p_provider_subject and disabled_at is null for update;
  if v_account_id is null then
    select account_id into v_account_id from kova_private.auth_identities
     where normalized_email = v_email and verified_at is not null and disabled_at is null
     order by provider = 'email' desc limit 1;
  end if;
  if v_account_id is null then
    select u.id into v_legacy_id from auth.users u
     where lower(u.email) = v_email and u.email_confirmed_at is not null and u.deleted_at is null
     order by u.created_at asc nulls last, u.id limit 1;
    v_account_id := coalesce(v_legacy_id, p_candidate_account_id);
  end if;
  insert into kova_private.auth_accounts(
    id, legacy_supabase_user_id, primary_email, display_name,
    email_verified_at, mfa_required, created_at, updated_at
  ) values (
    v_account_id, v_account_id, v_email, nullif(btrim(p_display_name), ''), p_now,
    kova_private.legacy_mfa_required(v_account_id),
    p_now, p_now
  ) on conflict (id) do update set
    email_verified_at = coalesce(kova_private.auth_accounts.email_verified_at, excluded.email_verified_at),
    display_name = coalesce(kova_private.auth_accounts.display_name, excluded.display_name),
    mfa_required = kova_private.auth_accounts.mfa_required or excluded.mfa_required,
    updated_at = excluded.updated_at;
  insert into kova_private.auth_identities(
    account_id, provider, provider_subject, normalized_email, verified_at, created_at, updated_at
  ) values (v_account_id, 'google', p_provider_subject, v_email, p_now, p_now, p_now)
  on conflict (provider, provider_subject) do update set
    verified_at = coalesce(kova_private.auth_identities.verified_at, excluded.verified_at),
    normalized_email = excluded.normalized_email, updated_at = excluded.updated_at
  returning kova_private.auth_identities.account_id into v_bound_id;
  v_account_id := v_bound_id;
  insert into kova_private.auth_session_handoffs(
    account_id, token_digest, assurance_level, expires_at, created_at
  ) values (
    v_account_id, kova_private.require_digest(p_handoff_digest_hex), 'aal1',
    p_handoff_expires_at, p_now
  );
  perform kova_private.audit(v_account_id, null, 'google_identity_authenticated', 'success', '{}', p_now);
  return query select v_account_id, v_account_id = p_candidate_account_id;
end
$$;

create function public.kova_auth_consume_handoff(
  p_handoff_digest_hex text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_handoff kova_private.auth_session_handoffs;
  v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if p_session_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_handoff from kova_private.auth_session_handoffs
   where token_digest = kova_private.require_digest(p_handoff_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_handoff.id is null then raise exception 'kova_auth_invalid_handoff'; end if;
  select * into v_account from kova_private.auth_accounts
   where id = v_handoff.account_id and deleted_at is null for update;
  if v_account.id is null then raise exception 'kova_auth_account_unavailable'; end if;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  update kova_private.auth_session_handoffs set consumed_at = p_now where id = v_handoff.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_session_digest_hex),
    v_handoff.assurance_level, v_account.session_epoch, p_session_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'oauth_handoff_consumed', 'success', '{}', p_now);
  return query select v_account.id, v_session_id, v_account.primary_email,
    v_account.email_verified_at is not null, v_handoff.assurance_level, p_session_expires_at;
end
$$;

-- Keep collaboration and directory lookups keyed to the verified Kova email,
-- while retaining the hosted auth.users row only as a compatibility principal.
create or replace function kova_private.verified_auth_user_for_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $
  with requested as (
    select lower(btrim(p_email)) as email
  ), candidates as (
    select a.id
      from kova_private.auth_accounts a, requested r
     where a.primary_email = r.email
       and a.email_verified_at is not null
       and a.deleted_at is null
    union
    select u.id
      from auth.users u, requested r
     where lower(btrim(u.email)) = r.email
       and u.email_confirmed_at is not null
       and u.deleted_at is null
  )
  select case when count(*) = 1 then max(id::text)::uuid else null end
    from candidates
$;

-- Full installs already have the private project invite implementations by this
-- timestamp. Isolated auth-schema tests intentionally do not, so parse the
-- replacement only when those compatibility functions exist.
do $project_invite_bridge$
begin
  if to_regprocedure('kova_private.accept_project_invite(uuid)') is not null
     and to_regprocedure('kova_private.decline_project_invite(uuid)') is not null then
    execute $accept$
create or replace function kova_private.accept_project_invite(_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $
declare
  caller_id uuid := auth.uid();
  invite_project_id uuid;
  invite_email text;
  invite_role public.project_role;
  invite_status text;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select i.project_id, lower(i.email), i.role, i.status
    into invite_project_id, invite_email, invite_role, invite_status
  from public.project_invites i
  where i.id = _invite_id
  for update;

  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if invite_status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;
  if kova_private.verified_auth_user_for_email(invite_email) is distinct from caller_id then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;

  insert into public.project_members(project_id, user_id, role)
  values (invite_project_id, caller_id, invite_role)
  on conflict (project_id, user_id) do nothing;

  update public.project_invites
     set status = 'accepted', accepted_at = coalesce(accepted_at, now())
   where id = _invite_id;
  return invite_project_id;
end;
$;
$accept$;
    execute $decline$
create or replace function kova_private.decline_project_invite(_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $
declare
  caller_id uuid := auth.uid();
  invite_email text;
  invite_status text;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(i.email), i.status
    into invite_email, invite_status
  from public.project_invites i
  where i.id = _invite_id
  for update;

  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if invite_status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;
  if kova_private.verified_auth_user_for_email(invite_email) is distinct from caller_id then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;

  update public.project_invites set status = 'revoked', accepted_at = null where id = _invite_id;
  return true;
end;
$;
$decline$;
  end if;
end
$project_invite_bridge$;

create function public.kova_auth_directory_email(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $
declare
  v_account kova_private.auth_accounts;
  v_email text;
begin
  select * into v_account from kova_private.auth_accounts where id = p_account_id;
  if v_account.id is not null then
    if v_account.deleted_at is null and v_account.email_verified_at is not null then
      return v_account.primary_email;
    end if;
    return null;
  end if;
  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = p_account_id and u.email_confirmed_at is not null and u.deleted_at is null;
  return v_email;
end
$;

revoke all on function kova_private.verified_auth_user_for_email(text) from public, anon, authenticated;
grant execute on function kova_private.verified_auth_user_for_email(text) to service_role;
revoke all on function public.kova_auth_directory_email(uuid) from public, anon, authenticated;
grant execute on function public.kova_auth_directory_email(uuid) to service_role;

revoke all on function kova_private.require_digest(text) from public, anon, authenticated;
revoke all on function kova_private.audit(uuid, uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function kova_private.legacy_mfa_required(uuid)
  from public, anon, authenticated;

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.kova_auth_create_password_account(uuid,text,text,text,text,timestamptz,jsonb,timestamptz)',
    'public.kova_auth_consume_verification(text,text,timestamptz,timestamptz)',
    'public.kova_auth_password_lookup(text,timestamptz)',
    'public.kova_auth_create_session(uuid,uuid,bigint,text,text,timestamptz,timestamptz)',
    'public.kova_auth_resolve_session(text,timestamptz)',
    'public.kova_auth_rotate_session(text,text,timestamptz,timestamptz)',
    'public.kova_auth_revoke_session(text,timestamptz)',
    'public.kova_auth_create_recovery(text,text,timestamptz,jsonb,timestamptz)',
    'public.kova_auth_recovery_target(text,timestamptz)',
    'public.kova_auth_consume_recovery(text,text,text,timestamptz,timestamptz)',
    'public.kova_auth_create_oauth_state(text,text,text,text,timestamptz,timestamptz)',
    'public.kova_auth_consume_oauth_state(text,timestamptz)',
    'public.kova_auth_finish_google(uuid,text,text,boolean,text,text,timestamptz,timestamptz)',
    'public.kova_auth_consume_handoff(text,text,timestamptz,timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end
$$;

grant usage on schema kova_private to service_role;
