-- Forward repair for ordered-schema Google MFA and pending-signup ownership.
-- This remains source-only until the separately guarded rehearsal migration.
-- Previously issued unbound challenges/handoffs are deliberately retired.

alter table kova_private.auth_mfa_login_challenges
  add column if not exists challenge_source text not null default 'password',
  add column if not exists session_epoch bigint,
  add column if not exists google_identity_id uuid references kova_private.auth_identities(id) on delete cascade;
alter table kova_private.auth_mfa_login_challenges
  alter column credential_id drop not null,
  alter column credential_revision drop not null;
alter table kova_private.auth_session_handoffs
  add column if not exists session_epoch bigint,
  add column if not exists google_identity_id uuid references kova_private.auth_identities(id) on delete cascade;
update kova_private.auth_mfa_login_challenges set consumed_at = greatest(now(), created_at)
 where consumed_at is null and session_epoch is null;
update kova_private.auth_session_handoffs set consumed_at = greatest(now(), created_at)
 where consumed_at is null and session_epoch is null;
alter table kova_private.auth_mfa_login_challenges
  add constraint auth_mfa_challenge_source_bound check (
    (challenge_source = 'password' and credential_id is not null and credential_revision is not null)
    or (challenge_source = 'google' and credential_id is null and credential_revision is null)
  ),
  add constraint auth_mfa_challenge_epoch_bound check (
    consumed_at is not null or (session_epoch is not null and session_epoch >= 0)
  );
alter table kova_private.auth_session_handoffs
  add constraint auth_handoff_epoch_bound check (
    consumed_at is not null or (session_epoch is not null and session_epoch >= 0 and google_identity_id is not null)
  );
create index auth_mfa_challenge_google_identity_idx
  on kova_private.auth_mfa_login_challenges(google_identity_id) where google_identity_id is not null;
create index auth_handoff_google_identity_idx
  on kova_private.auth_session_handoffs(google_identity_id) where google_identity_id is not null;

create function kova_private.bind_primary_auth_challenge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_account kova_private.auth_accounts;
begin
  select * into v_account from kova_private.auth_accounts where id = new.account_id for update;
  if v_account.id is null or v_account.deleted_at is not null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > new.created_at) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  new.session_epoch := v_account.session_epoch;
  if tg_table_name = 'auth_session_handoffs' then
    select i.id into new.google_identity_id from kova_private.auth_identities i
     where i.account_id = v_account.id and i.provider = 'google' and i.disabled_at is null
       and i.verified_at is not null and i.normalized_email = v_account.primary_email for share;
    if new.google_identity_id is null then raise exception 'kova_auth_invalid_google_identity'; end if;
  elsif new.challenge_source = 'google' then
    select i.id into new.google_identity_id from kova_private.auth_identities i
     where i.account_id = v_account.id and i.provider = 'google' and i.disabled_at is null
       and i.verified_at is not null and i.normalized_email = v_account.primary_email for share;
    if new.google_identity_id is null then raise exception 'kova_auth_invalid_google_identity'; end if;
  elsif new.challenge_source = 'password' then
    new.google_identity_id := null;
  else
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  return new;
end
$$;
revoke all on function kova_private.bind_primary_auth_challenge() from public, anon, authenticated, service_role;
create trigger auth_mfa_primary_binding before insert on kova_private.auth_mfa_login_challenges
 for each row execute function kova_private.bind_primary_auth_challenge();
create trigger auth_handoff_primary_binding before insert on kova_private.auth_session_handoffs
 for each row execute function kova_private.bind_primary_auth_challenge();
create or replace function public.kova_auth_create_password_account(
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
  -- Serialize password signup and Google ownership for this normalized mailbox.
  perform pg_advisory_xact_lock(hashtextextended('kova_auth_email:' || v_email, 0));

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
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'rejected', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, false;
    return;
  end if;

  insert into kova_private.auth_credentials(
    account_id, credential_type, secret_hash, algorithm, activated_at, created_at, updated_at
  ) values (v_account_id, 'password', p_password_hash, 'scrypt-v1', null, p_now, p_now)
  on conflict (account_id) where credential_type = 'password' and disabled_at is null do nothing;
  if not found then
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'rejected', '{}', p_now);
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

create or replace function public.kova_auth_finish_google(
  p_candidate_account_id uuid, p_provider_subject text, p_email text,
  p_email_verified boolean, p_display_name text, p_handoff_digest_hex text,
  p_handoff_expires_at timestamptz, p_now timestamptz default now()
) returns table(account_id uuid, candidate_used boolean)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email)); v_account_id uuid; v_bound_id uuid; v_legacy_id uuid;
  v_account kova_private.auth_accounts; v_google kova_private.auth_identities;
begin
  if p_candidate_account_id is null or p_email_verified is distinct from true or
     p_provider_subject is null or char_length(p_provider_subject) not between 1 and 512 or
     v_email is null or char_length(v_email) not between 3 and 320 or
     p_now is null or not isfinite(p_now) or p_handoff_expires_at is null or
     not isfinite(p_handoff_expires_at) or p_handoff_expires_at <= p_now then
    raise exception 'kova_auth_invalid_google_identity';
  end if;
  perform kova_private.require_digest(p_handoff_digest_hex);
  perform pg_advisory_xact_lock(hashtextextended('kova_auth_email:' || v_email, 0));
  select * into v_google from kova_private.auth_identities
   where provider = 'google' and provider_subject = p_provider_subject;
  if v_google.id is not null then
    if v_google.disabled_at is not null or v_google.verified_at is null then
      raise exception 'kova_auth_invalid_google_identity';
    end if;
    v_account_id := v_google.account_id;
  end if;
  if v_account_id is null then
    select account_id into v_account_id from kova_private.auth_identities
     where normalized_email = v_email and verified_at is not null and disabled_at is null
     order by provider = 'email' desc limit 1;
  end if;
  if v_account_id is null then
    -- A provider-verified mailbox may claim its pending signup, never its
    -- unverified caller's chosen password. Keep the stable application UUID.
    select a.id into v_account_id from kova_private.auth_accounts a where a.primary_email = v_email;
  end if;
  if v_account_id is not null then
    select * into v_account from kova_private.auth_accounts where id = v_account_id for update;
    if v_account.id is null or v_account.deleted_at is not null
      or v_account.primary_email is distinct from v_email
      or (v_account.suspended_until is not null and v_account.suspended_until > p_now) then
      raise exception 'kova_auth_account_unavailable';
    end if;
    -- Recheck provider state after the account lock. Do not revive a disabled
    -- identity or bind a different subject to an existing Google authority.
    select * into v_google from kova_private.auth_identities
     where account_id = v_account_id and provider = 'google' for update;
    if v_google.id is not null and (v_google.provider_subject <> p_provider_subject
      or v_google.disabled_at is not null or v_google.verified_at is null) then
      raise exception 'kova_auth_invalid_google_identity';
    end if;
    update kova_private.auth_credentials set disabled_at = p_now, updated_at = p_now
     where account_id = v_account_id and credential_type = 'password'
       and activated_at is null and disabled_at is null;
    if found then
      update kova_private.auth_email_verifications set consumed_at = p_now
       where account_id = v_account_id and consumed_at is null;
    end if;
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

create or replace function public.kova_auth_consume_handoff(
  p_handoff_digest_hex text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_handoff kova_private.auth_session_handoffs;
  v_handoff_account_id uuid;
  v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if p_now is null or not isfinite(p_now) or p_session_expires_at is null
    or not isfinite(p_session_expires_at) or p_session_expires_at <= p_now then
    raise exception 'kova_auth_invalid_session';
  end if;
  select account_id into v_handoff_account_id from kova_private.auth_session_handoffs
   where token_digest = kova_private.require_digest(p_handoff_digest_hex);
  if v_handoff_account_id is null then raise exception 'kova_auth_invalid_handoff'; end if;
  perform 1 from kova_private.auth_accounts where id = v_handoff_account_id for update;
  select * into v_handoff from kova_private.auth_session_handoffs
   where token_digest = kova_private.require_digest(p_handoff_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_handoff.id is null then raise exception 'kova_auth_invalid_handoff'; end if;
  select * into v_account from kova_private.auth_accounts
   where id = v_handoff.account_id and deleted_at is null for update;
  if v_handoff.session_epoch is distinct from v_account.session_epoch
    or v_handoff.created_at > p_now or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or not exists(select 1 from kova_private.auth_identities i
      where i.id = v_handoff.google_identity_id and i.account_id = v_account.id
        and i.provider = 'google' and i.disabled_at is null and i.verified_at is not null
        and i.normalized_email = v_account.primary_email) then
    raise exception 'kova_auth_invalid_handoff';
  end if;
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

create or replace function public.kova_auth_consume_handoff_with_mfa(
  p_handoff_digest_hex text, p_session_digest_hex text, p_session_expires_at timestamptz,
  p_challenge_digest_hex text, p_challenge_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(
  mfa_required boolean, account_id uuid, session_id uuid, email text,
  email_verified boolean, assurance_level text, expires_at timestamptz
)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_handoff kova_private.auth_session_handoffs;
  v_handoff_account_id uuid;
  v_account kova_private.auth_accounts;
  v_factor kova_private.auth_mfa_factors;
  v_session_id uuid;
  v_mfa_required boolean;
begin
  if p_now is null or not isfinite(p_now) or p_session_expires_at is null
    or not isfinite(p_session_expires_at) or p_session_expires_at <= p_now then
    raise exception 'kova_auth_invalid_session';
  end if;
  select account_id into v_handoff_account_id from kova_private.auth_session_handoffs
   where token_digest = kova_private.require_digest(p_handoff_digest_hex);
  if v_handoff_account_id is null then raise exception 'kova_auth_invalid_handoff'; end if;
  perform 1 from kova_private.auth_accounts where id = v_handoff_account_id for update;
  select * into v_handoff from kova_private.auth_session_handoffs
   where token_digest = kova_private.require_digest(p_handoff_digest_hex)
     and consumed_at is null and expires_at > p_now for update;
  if v_handoff.id is null then raise exception 'kova_auth_invalid_handoff'; end if;

  select * into v_account from kova_private.auth_accounts
   where id = v_handoff.account_id and deleted_at is null for update;
  if v_handoff.session_epoch is distinct from v_account.session_epoch
    or v_handoff.created_at > p_now or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or not exists(select 1 from kova_private.auth_identities i
      where i.id = v_handoff.google_identity_id and i.account_id = v_account.id
        and i.provider = 'google' and i.disabled_at is null and i.verified_at is not null
        and i.normalized_email = v_account.primary_email) then
    raise exception 'kova_auth_invalid_handoff';
  end if;
  if v_account.id is null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    then raise exception 'kova_auth_account_unavailable'; end if;

  v_mfa_required := v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id);
  if v_mfa_required then
    if p_challenge_expires_at is null or not isfinite(p_challenge_expires_at)
      or p_challenge_expires_at <= p_now or p_challenge_expires_at > p_now + interval '10 minutes' then
      raise exception 'kova_auth_invalid_mfa_challenge';
    end if;
    perform kova_private.require_digest(p_challenge_digest_hex);
    select * into v_factor from kova_private.auth_mfa_factors f
     where f.account_id = v_account.id and f.factor_type = 'totp' and f.state = 'active'
       and f.disabled_at is null and f.verified_at is not null
     order by f.verified_at asc nulls last, f.created_at asc limit 1;
    if v_factor.id is null then raise exception 'kova_auth_mfa_migration_required'; end if;

    update kova_private.auth_mfa_login_challenges set consumed_at = p_now
     where account_id = v_account.id and consumed_at is null;
    insert into kova_private.auth_mfa_login_challenges(
      account_id, credential_id, credential_revision, factor_id, challenge_source,
      token_digest, expires_at, created_at
    ) values (
      v_account.id, null, null, v_factor.id, 'google',
      kova_private.require_digest(p_challenge_digest_hex), p_challenge_expires_at, p_now
    );
    update kova_private.auth_session_handoffs set consumed_at = p_now where id = v_handoff.id;
    perform kova_private.audit(v_account.id, null, 'google_mfa_challenge_created', 'success',
      jsonb_build_object('factor_id', v_factor.id), p_now);
    return query select true, v_account.id, null::uuid, v_account.primary_email,
      true, null::text, p_challenge_expires_at;
    return;
  end if;

  update kova_private.auth_session_handoffs set consumed_at = p_now where id = v_handoff.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_session_digest_hex),
    v_handoff.assurance_level, v_account.session_epoch, p_session_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'oauth_handoff_consumed', 'success', '{}', p_now);
  return query select false, v_account.id, v_session_id, v_account.primary_email,
    true, v_handoff.assurance_level, p_session_expires_at;
end
$$;

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
  if v_challenge.session_epoch is distinct from v_account.session_epoch
    or v_challenge.created_at > p_now then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  if v_challenge.challenge_source = 'password' then
    select c.id into v_checked from kova_private.auth_credentials c
     where c.id = v_challenge.credential_id and c.account_id = v_account.id
       and c.revision = v_challenge.credential_revision and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null for share;
  elsif v_challenge.challenge_source = 'google' then
    select i.id into v_checked from kova_private.auth_identities i
     where i.id = v_challenge.google_identity_id and i.account_id = v_account.id
       and i.provider = 'google' and i.disabled_at is null and i.verified_at is not null
       and i.normalized_email = v_account.primary_email for share;
  else
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
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
  if v_challenge.session_epoch is distinct from v_account.session_epoch
    or v_challenge.created_at > p_now then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  if v_challenge.challenge_source = 'password' then
    select c.id into v_credential_id from kova_private.auth_credentials c
     where c.id = v_challenge.credential_id and c.account_id = v_account.id
       and c.revision = v_challenge.credential_revision and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null for share;
  elsif v_challenge.challenge_source = 'google' then
    select i.id into v_credential_id from kova_private.auth_identities i
     where i.id = v_challenge.google_identity_id and i.account_id = v_account.id
       and i.provider = 'google' and i.disabled_at is null and i.verified_at is not null
       and i.normalized_email = v_account.primary_email for share;
  else
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
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
revoke all on function public.kova_auth_consume_handoff_with_mfa(text,text,timestamptz,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_consume_handoff_with_mfa(text,text,timestamptz,text,timestamptz,timestamptz)
  to service_role;
