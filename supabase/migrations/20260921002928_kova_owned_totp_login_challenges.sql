-- Short-lived, one-time challenges for completing a password login with a
-- Kova-owned TOTP factor. These rows never contain the plaintext challenge or
-- TOTP secret. RPC access remains service-role only.

create table kova_private.auth_mfa_login_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kova_private.auth_accounts(id) on delete cascade,
  credential_id uuid not null references kova_private.auth_credentials(id) on delete cascade,
  credential_revision bigint not null check (credential_revision > 0),
  factor_id uuid not null references kova_private.auth_mfa_factors(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index auth_mfa_login_challenges_account_idx
  on kova_private.auth_mfa_login_challenges (account_id, expires_at)
  where consumed_at is null;

alter table kova_private.auth_mfa_login_challenges enable row level security;
revoke all on kova_private.auth_mfa_login_challenges from public, anon, authenticated;

create function public.kova_auth_begin_mfa_login(
  p_account_id uuid, p_credential_id uuid, p_credential_revision bigint,
  p_challenge_digest_hex text, p_expires_at timestamptz, p_now timestamptz default now()
) returns table(factor_id uuid, secret_envelope text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_factor kova_private.auth_mfa_factors;
begin
  if p_expires_at <= p_now or p_expires_at > p_now + interval '10 minutes' then
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  if not exists (
    select 1 from kova_private.auth_credentials c
     where c.id = p_credential_id and c.account_id = p_account_id
       and c.revision = p_credential_revision and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null
  ) then raise exception 'kova_auth_stale_credential'; end if;
  select * into v_factor from kova_private.auth_mfa_factors f
   where f.account_id = p_account_id and f.factor_type = 'totp' and f.state = 'active'
     and f.disabled_at is null order by f.verified_at asc nulls last, f.created_at asc limit 1;
  if v_factor.id is null then raise exception 'kova_auth_mfa_migration_required'; end if;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now
   where account_id = p_account_id and consumed_at is null;
  insert into kova_private.auth_mfa_login_challenges(
    account_id, credential_id, credential_revision, factor_id, token_digest, expires_at, created_at
  ) values (
    p_account_id, p_credential_id, p_credential_revision, v_factor.id,
    kova_private.require_digest(p_challenge_digest_hex), p_expires_at, p_now
  );
  perform kova_private.audit(p_account_id, null, 'mfa_login_challenge_created', 'success', '{}', p_now);
  return query select v_factor.id, convert_from(v_factor.secret_ciphertext, 'utf8');
end
$$;

create function public.kova_auth_read_mfa_login_challenge(
  p_challenge_digest_hex text, p_now timestamptz default now()
) returns table(account_id uuid, credential_id uuid, credential_revision bigint,
  factor_id uuid, secret_envelope text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_challenge kova_private.auth_mfa_login_challenges; v_factor kova_private.auth_mfa_factors;
begin
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and consumed_at is null and expires_at > p_now and attempts < 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  update kova_private.auth_mfa_login_challenges set attempts = attempts + 1 where id = v_challenge.id;
  select * into v_factor from kova_private.auth_mfa_factors
   where id = v_challenge.factor_id and account_id = v_challenge.account_id
     and factor_type = 'totp' and state = 'active' and disabled_at is null;
  if v_factor.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  return query select v_challenge.account_id, v_challenge.credential_id,
    v_challenge.credential_revision, v_factor.id, convert_from(v_factor.secret_ciphertext, 'utf8');
end
$$;

create function public.kova_auth_finish_mfa_login(
  p_challenge_digest_hex text, p_token_digest_hex text, p_expires_at timestamptz,
  p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_challenge kova_private.auth_mfa_login_challenges; v_account kova_private.auth_accounts; v_session_id uuid;
begin
  if p_expires_at <= p_now then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and consumed_at is null and expires_at > p_now and attempts between 1 and 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;
  select * into v_account from kova_private.auth_accounts where id = v_challenge.account_id for update;
  if v_account.id is null or v_account.deleted_at is not null or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or not exists (
      select 1 from kova_private.auth_credentials c where c.id = v_challenge.credential_id
        and c.account_id = v_challenge.account_id and c.revision = v_challenge.credential_revision
        and c.activated_at is not null and c.disabled_at is null
    ) then raise exception 'kova_auth_account_unavailable'; end if;
  update kova_private.auth_mfa_login_challenges set consumed_at = p_now where id = v_challenge.id;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (
    v_account.id, kova_private.require_digest(p_token_digest_hex), 'aal2',
    v_account.session_epoch, p_expires_at, p_now, p_now
  ) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'mfa_login', 'success',
    jsonb_build_object('factor_id', v_challenge.factor_id), p_now);
  return query select v_session_id, v_account.id, v_account.primary_email,
    true, 'aal2'::text, p_expires_at;
end
$$;

revoke all on function public.kova_auth_begin_mfa_login(uuid, uuid, bigint, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_read_mfa_login_challenge(text, timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_finish_mfa_login(text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.kova_auth_begin_mfa_login(uuid, uuid, bigint, text, timestamptz, timestamptz) to service_role;
grant execute on function public.kova_auth_read_mfa_login_challenge(text, timestamptz) to service_role;
grant execute on function public.kova_auth_finish_mfa_login(text, text, timestamptz, timestamptz) to service_role;
