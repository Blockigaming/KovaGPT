-- LOCAL ADDITIVE CANDIDATE. CLI-generated filename; not remotely applied.
-- Reconcile the three copied credential functions with current Terminal source.
-- No account-deletion, billing, deployment or existing-row migration is included.
begin;

-- Legacy storage remains accepted as before. Argon2id has one bounded profile;
-- do not permit a PHC string to choose arbitrary database-approved KDF costs.
create function kova_private.password_hash_algorithm(p_hash text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare v_salt text; v_key text; v_salt_bytes bytea; v_key_bytes bytea;
begin
  if p_hash is null or char_length(p_hash) not between 64 and 2048 then return null; end if;
  if p_hash like 'scrypt-v1$32768$8$1$%' then return 'scrypt-v1'; end if;
  if p_hash !~ '^[$]argon2id[$]v=19[$](m=19456,t=2,p=1|m=19456,p=1,t=2)[$][A-Za-z0-9+/]{22}[$][A-Za-z0-9+/]{43}$' then
    return null;
  end if;
  v_salt := split_part(p_hash, '$', 5);
  v_key := split_part(p_hash, '$', 6);
  v_salt_bytes := decode(v_salt || '==', 'base64');
  v_key_bytes := decode(v_key || '=', 'base64');
  if octet_length(v_salt_bytes) <> 16 or octet_length(v_key_bytes) <> 32
    or rtrim(encode(v_salt_bytes, 'base64'), '=') <> v_salt
    or rtrim(encode(v_key_bytes, 'base64'), '=') <> v_key then return null; end if;
  return 'argon2id';
exception when invalid_parameter_value or invalid_text_representation then
  return null;
end
$$;
revoke all on function kova_private.password_hash_algorithm(text)
  from public, anon, authenticated, service_role;

-- Existing reviewed signup/recovery/MFA writers label all hashes scrypt-v1.
-- Normalize only supported representations at the shared private-row boundary.
-- This also preserves future writer fixes: those functions are not replaced.
create function kova_private.bind_password_hash_algorithm()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_algorithm text;
begin
  v_algorithm := kova_private.password_hash_algorithm(new.secret_hash);
  if new.credential_type <> 'password' or v_algorithm is null
    or new.algorithm not in ('scrypt-v1', 'argon2id') then
    raise exception 'kova_auth_invalid_password';
  end if;
  new.algorithm := v_algorithm;
  return new;
end
$$;
revoke all on function kova_private.bind_password_hash_algorithm()
  from public, anon, authenticated, service_role;
create trigger kova_bind_password_hash_algorithm
  before insert or update of secret_hash, algorithm on kova_private.auth_credentials
  for each row execute function kova_private.bind_password_hash_algorithm();

alter table kova_private.auth_credentials drop constraint auth_credentials_algorithm_check;
alter table kova_private.auth_credentials add constraint auth_credentials_algorithm_check
  check (algorithm in ('scrypt-v1', 'argon2id'));
alter table kova_private.auth_credentials add constraint auth_credentials_argon2id_profile_check
  check (algorithm <> 'argon2id' or
    kova_private.password_hash_algorithm(secret_hash) is not distinct from 'argon2id');

-- The remaining existing validation gates explicitly reject every non-scrypt
-- value before insertion. Their full reviewed bodies are retained below, with
-- only their password-representation predicates broadened.


create or replace function public.kova_auth_change_password(
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
  if kova_private.password_hash_algorithm(p_password_hash) is null then
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

create or replace function public.kova_auth_begin_legacy_mfa_migration(
  p_account_id uuid, p_secret_envelope text, p_friendly_name text,
  p_password_hash text default null, p_now timestamptz default now()
) returns table(factor_id uuid, email text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_account kova_private.auth_accounts;
  v_legacy uuid;
  v_factor_id uuid;
  v_has_primary boolean;
  v_expires timestamptz := p_now + interval '10 minutes';
begin
  if p_account_id is null or p_now is null or not isfinite(p_now)
    or p_secret_envelope is null or char_length(p_secret_envelope) not between 16 and 4096
    or p_friendly_name is null or char_length(btrim(p_friendly_name)) not between 1 and 120
    or (p_password_hash is not null and
      kova_private.password_hash_algorithm(p_password_hash) is null) then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;

  select * into v_account from kova_private.auth_accounts a
   where a.id = p_account_id for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_account.legacy_supabase_user_id is null then
    raise exception 'kova_auth_account_unavailable';
  end if;
  v_legacy := v_account.legacy_supabase_user_id;
  if not kova_private.legacy_principal_permitted(v_legacy)
    or not kova_private.legacy_mfa_required(v_legacy) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;

  v_has_primary :=
    exists(
      select 1 from kova_private.auth_credentials c
       where c.account_id = v_account.id and c.credential_type = 'password'
         and c.activated_at is not null and c.disabled_at is null
    )
    or exists(
      select 1 from kova_private.auth_identities i
       where i.account_id = v_account.id and i.provider = 'google'
         and i.verified_at is not null and i.disabled_at is null
         and i.normalized_email = v_account.primary_email
    )
    or exists(
      select 1 from kova_private.auth_passkeys p
       where p.account_id = v_account.id and p.disabled_at is null
    );
  if not v_has_primary and p_password_hash is null then
    raise exception 'kova_auth_primary_migration_required' using errcode = '42501';
  end if;

  update kova_private.auth_mfa_factors f
     set state = 'disabled', disabled_at = p_now, updated_at = p_now
   where f.id in (
     select m.factor_id from kova_private.auth_legacy_mfa_migrations m
      where m.account_id = v_account.id and m.consumed_at is null
   ) and f.state = 'pending' and f.disabled_at is null;
  update kova_private.auth_legacy_mfa_migrations
     set consumed_at = p_now
   where account_id = v_account.id and consumed_at is null;

  insert into kova_private.auth_mfa_factors(
    account_id, factor_type, state, friendly_name, secret_ciphertext,
    created_at, updated_at
  ) values (
    v_account.id, 'totp', 'pending', btrim(p_friendly_name),
    convert_to(p_secret_envelope, 'utf8'), p_now, p_now
  ) returning id into v_factor_id;

  insert into kova_private.auth_legacy_mfa_migrations(
    account_id, legacy_user_id, factor_id, staged_password_hash,
    expires_at, created_at
  ) values (
    v_account.id, v_legacy, v_factor_id,
    case when v_has_primary then null else p_password_hash end,
    v_expires, p_now
  );

  perform kova_private.audit(
    v_account.id, null, 'legacy_mfa_migration_started', 'success',
    jsonb_build_object('factor_id', v_factor_id, 'password_staged', not v_has_primary), p_now
  );
  return query select v_factor_id, v_account.primary_email, v_expires;
end
$$;

create or replace function public.kova_auth_activate_legacy_mfa_migration(
  p_account_id uuid, p_factor_id uuid, p_recovery_digest_hexes text[],
  p_token_digest_hex text, p_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_account kova_private.auth_accounts;
  v_migration kova_private.auth_legacy_mfa_migrations;
  v_factor kova_private.auth_mfa_factors;
  v_legacy uuid;
  v_has_primary boolean;
  v_epoch bigint;
  v_digest text;
  v_session_id uuid;
begin
  if p_account_id is null or p_factor_id is null or p_now is null or not isfinite(p_now)
    or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at <= p_now
    or coalesce(array_ndims(p_recovery_digest_hexes), 0) <> 1
    or coalesce(cardinality(p_recovery_digest_hexes), 0) <> 8
    or (select count(distinct d) from unnest(p_recovery_digest_hexes) as codes(d)) <> 8 then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  perform kova_private.require_digest(p_token_digest_hex);
  foreach v_digest in array p_recovery_digest_hexes loop
    perform kova_private.require_digest(v_digest);
    if exists(
      select 1 from kova_private.auth_mfa_recovery_codes r
       where r.code_digest = kova_private.require_digest(v_digest)
    ) then raise exception 'kova_auth_invalid_recovery_codes'; end if;
  end loop;

  select * into v_account from kova_private.auth_accounts a
   where a.id = p_account_id for update;
  select * into v_migration from kova_private.auth_legacy_mfa_migrations m
   where m.account_id = p_account_id and m.factor_id = p_factor_id
     and m.consumed_at is null and m.expires_at > p_now
     and m.created_at <= p_now and m.attempts between 1 and 5 for update;
  select * into v_factor from kova_private.auth_mfa_factors f
   where f.id = p_factor_id and f.account_id = p_account_id
     and f.factor_type = 'totp' and f.state = 'pending'
     and f.disabled_at is null for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_migration.id is null or v_factor.id is null
    or v_migration.legacy_user_id is distinct from v_account.legacy_supabase_user_id then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  v_legacy := v_migration.legacy_user_id;
  if not kova_private.legacy_principal_permitted(v_legacy)
    or not kova_private.legacy_mfa_required(v_legacy) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;

  v_has_primary :=
    exists(
      select 1 from kova_private.auth_credentials c
       where c.account_id = v_account.id and c.credential_type = 'password'
         and c.activated_at is not null and c.disabled_at is null
    )
    or exists(
      select 1 from kova_private.auth_identities i
       where i.account_id = v_account.id and i.provider = 'google'
         and i.verified_at is not null and i.disabled_at is null
         and i.normalized_email = v_account.primary_email
    )
    or exists(
      select 1 from kova_private.auth_passkeys p
       where p.account_id = v_account.id and p.disabled_at is null
    );

  if not v_has_primary then
    if kova_private.password_hash_algorithm(v_migration.staged_password_hash) is null then
      raise exception 'kova_auth_primary_migration_required';
    end if;
    update kova_private.auth_credentials
       set disabled_at = p_now, updated_at = p_now
     where account_id = v_account.id and credential_type = 'password'
       and disabled_at is null;
    insert into kova_private.auth_identities(
      account_id, provider, provider_subject, normalized_email,
      verified_at, created_at, updated_at
    ) values (
      v_account.id, 'email', v_account.primary_email, v_account.primary_email,
      p_now, p_now, p_now
    ) on conflict (account_id, provider) do update set
      provider_subject = excluded.provider_subject,
      normalized_email = excluded.normalized_email,
      verified_at = coalesce(kova_private.auth_identities.verified_at, excluded.verified_at),
      disabled_at = null,
      updated_at = excluded.updated_at;
    insert into kova_private.auth_credentials(
      account_id, credential_type, secret_hash, algorithm, revision,
      activated_at, created_at, updated_at
    ) values (
      v_account.id, 'password', v_migration.staged_password_hash,
      'scrypt-v1', 1, p_now, p_now, p_now
    );
  end if;

  update kova_private.auth_mfa_factors
     set state = 'active', verified_at = p_now, updated_at = p_now
   where id = v_factor.id;
  update kova_private.auth_accounts
     set mfa_required = true, session_epoch = session_epoch + 1, updated_at = p_now
   where id = v_account.id
   returning session_epoch into v_epoch;

  update kova_private.auth_sessions
     set revoked_at = coalesce(revoked_at, p_now)
   where account_id = v_account.id and revoked_at is null;
  update kova_private.auth_mfa_login_challenges
     set consumed_at = coalesce(consumed_at, p_now)
   where account_id = v_account.id and consumed_at is null;
  update kova_private.auth_session_handoffs
     set consumed_at = coalesce(consumed_at, p_now)
   where account_id = v_account.id and consumed_at is null;
  update kova_private.auth_password_recoveries
     set consumed_at = coalesce(consumed_at, p_now)
   where account_id = v_account.id and consumed_at is null;

  delete from kova_private.auth_mfa_recovery_codes where account_id = v_account.id;
  foreach v_digest in array p_recovery_digest_hexes loop
    insert into kova_private.auth_mfa_recovery_codes(account_id, code_digest, created_at)
    values(v_account.id, kova_private.require_digest(v_digest), p_now);
  end loop;

  perform kova_private.retire_legacy_auth(v_legacy, p_now);
  update kova_private.auth_legacy_mfa_migrations
     set consumed_at = p_now
   where id = v_migration.id;

  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch,
    expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_token_digest_hex),
    'aal2', v_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;

  perform kova_private.audit(
    v_account.id, v_session_id, 'legacy_mfa_migrated', 'success',
    jsonb_build_object('factor_id', v_factor.id, 'legacy_user_id', v_legacy), p_now
  );
  return query
    select v_session_id, v_account.id, v_account.primary_email,
      true, 'aal2'::text, p_expires_at;
end
$$;

-- Rehash is a representation upgrade after COMPLETE authentication, never
-- evidence that a password/MFA challenge succeeded. Trusted server code must
-- verify the submitted password and generate the Argon2id hash before calling.
-- Lock order matches existing security mutations: account, session, credential.
create function public.kova_auth_upgrade_password_hash(
  p_account_id uuid, p_credential_id uuid, p_credential_revision bigint,
  p_old_password_hash text, p_new_password_hash text, p_session_digest_hex text,
  p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions; v_credential kova_private.auth_credentials;
begin
  if p_account_id is null or p_credential_id is null or p_credential_revision is null
    or p_credential_revision < 1
    or kova_private.password_hash_algorithm(p_old_password_hash) is distinct from 'scrypt-v1'
    or kova_private.password_hash_algorithm(p_new_password_hash) is distinct from 'argon2id' then
    return false;
  end if;
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  if v_session.account_id is distinct from p_account_id then return false; end if;
  select * into v_credential from kova_private.auth_credentials c
   where c.id = p_credential_id and c.account_id = p_account_id
     and c.credential_type = 'password' and c.algorithm = 'scrypt-v1'
     and c.revision = p_credential_revision and c.secret_hash = p_old_password_hash
     and c.activated_at is not null and c.disabled_at is null for update;
  if not found then return false; end if;
  -- Same password: keep revision, epochs, factor challenges and owned sessions.
  -- Existing legacy-retirement triggers still run transactionally; do not
  -- bypass them or revive old hosted authority during a representation upgrade.
  update kova_private.auth_credentials
     set secret_hash = p_new_password_hash, algorithm = 'argon2id', updated_at = p_now
   where id = v_credential.id;
  perform kova_private.audit(p_account_id, v_session.id, 'password_hash_upgraded', 'success',
    jsonb_build_object('algorithm', 'argon2id'), p_now);
  return true;
end
$$;
revoke all on function public.kova_auth_upgrade_password_hash(uuid,uuid,bigint,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_upgrade_password_hash(uuid,uuid,bigint,text,text,text,timestamptz)
  to service_role;

commit;
