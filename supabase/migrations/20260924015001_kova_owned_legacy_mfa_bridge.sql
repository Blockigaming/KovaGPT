-- Dual-mode bridge for accounts that still require a verified hosted MFA
-- factor. The hosted factor secret is never copied: a current hosted AAL2
-- session authorizes a fresh Kova TOTP enrollment, and hosted authority is
-- retired only after the fresh factor (and, when needed, a staged Kova
-- password) has been verified.
begin;

create table kova_private.auth_legacy_mfa_migrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  legacy_user_id uuid not null,
  factor_id uuid not null unique references kova_private.auth_mfa_factors(id) on delete cascade,
  staged_password_hash text check (
    staged_password_hash is null or char_length(staged_password_hash) between 64 and 2048
  ),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (consumed_at is null or consumed_at >= created_at)
);
create unique index auth_legacy_mfa_migrations_active_account_idx
  on kova_private.auth_legacy_mfa_migrations(account_id)
  where consumed_at is null;
alter table kova_private.auth_legacy_mfa_migrations enable row level security;
revoke all on kova_private.auth_legacy_mfa_migrations
  from public, anon, authenticated, service_role;

create function public.kova_auth_legacy_mfa_migration_status(
  p_account_id uuid, p_now timestamptz default now()
) returns table(email text, primary_ready boolean, legacy_mfa boolean)
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  v_account kova_private.auth_accounts;
  v_legacy uuid;
begin
  if p_account_id is null or p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  select * into v_account from kova_private.auth_accounts a
   where a.id = p_account_id and a.deleted_at is null;
  if v_account.id is null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_account.legacy_supabase_user_id is null then
    raise exception 'kova_auth_account_unavailable';
  end if;
  v_legacy := v_account.legacy_supabase_user_id;
  if not kova_private.legacy_principal_permitted(v_legacy) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  return query
    select v_account.primary_email,
      (
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
        )
      ),
      kova_private.legacy_mfa_required(v_legacy);
end
$$;
revoke all on function public.kova_auth_legacy_mfa_migration_status(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_mfa_migration_status(uuid,timestamptz)
  to service_role;

create function public.kova_auth_begin_legacy_mfa_migration(
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
      (char_length(p_password_hash) not between 64 and 2048
       or p_password_hash not like 'scrypt-v1$32768$8$1$%')) then
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
revoke all on function public.kova_auth_begin_legacy_mfa_migration(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_begin_legacy_mfa_migration(uuid,text,text,text,timestamptz)
  to service_role;

create function public.kova_auth_read_legacy_mfa_migration(
  p_account_id uuid, p_factor_id uuid, p_now timestamptz default now()
) returns table(secret_envelope text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  v_account kova_private.auth_accounts;
  v_migration kova_private.auth_legacy_mfa_migrations;
  v_factor kova_private.auth_mfa_factors;
begin
  if p_account_id is null or p_factor_id is null or p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  select * into v_account from kova_private.auth_accounts a
   where a.id = p_account_id for update;
  select * into v_migration from kova_private.auth_legacy_mfa_migrations m
   where m.account_id = p_account_id and m.factor_id = p_factor_id
     and m.consumed_at is null and m.expires_at > p_now
     and m.created_at <= p_now and m.attempts < 5 for update;
  select * into v_factor from kova_private.auth_mfa_factors f
   where f.id = p_factor_id and f.account_id = p_account_id
     and f.factor_type = 'totp' and f.state = 'pending'
     and f.disabled_at is null for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_migration.id is null or v_factor.id is null
    or v_migration.legacy_user_id is distinct from v_account.legacy_supabase_user_id
    or not kova_private.legacy_principal_permitted(v_migration.legacy_user_id)
    or not kova_private.legacy_mfa_required(v_migration.legacy_user_id) then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  update kova_private.auth_legacy_mfa_migrations
     set attempts = attempts + 1
   where id = v_migration.id;
  return query select convert_from(v_factor.secret_ciphertext, 'utf8');
end
$$;
revoke all on function public.kova_auth_read_legacy_mfa_migration(uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_read_legacy_mfa_migration(uuid,uuid,timestamptz)
  to service_role;

create function public.kova_auth_activate_legacy_mfa_migration(
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
    if v_migration.staged_password_hash is null
      or char_length(v_migration.staged_password_hash) not between 64 and 2048
      or v_migration.staged_password_hash not like 'scrypt-v1$32768$8$1$%' then
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
revoke all on function public.kova_auth_activate_legacy_mfa_migration(
  uuid,uuid,text[],text,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.kova_auth_activate_legacy_mfa_migration(
  uuid,uuid,text[],text,timestamptz,timestamptz
) to service_role;

create function public.kova_auth_legacy_mfa_gap_count(p_now timestamptz default now())
returns bigint
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select count(*)
    from kova_private.auth_accounts a
   where a.deleted_at is null
     and a.email_verified_at is not null
     and (a.suspended_until is null or a.suspended_until <= p_now)
     and a.legacy_supabase_user_id is not null
     and kova_private.legacy_mfa_required(a.legacy_supabase_user_id)
     and not exists(
       select 1 from kova_private.auth_mfa_factors f
        where f.account_id = a.id and f.factor_type = 'totp'
          and f.state = 'active' and f.verified_at is not null
          and f.disabled_at is null
     )
$$;
revoke all on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_mfa_gap_count(timestamptz)
  to service_role;

commit;
