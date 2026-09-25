-- Allow any active owned TOTP factor to satisfy a still-live MFA challenge.
-- The browser never receives factor secrets; these service-role-only RPCs expose
-- encrypted envelopes only to the application server, which verifies the code
-- before atomically binding the matched factor for the final AAL2 session.
begin;

create or replace function public.kova_auth_read_mfa_login_challenge(
  p_challenge_digest_hex text, p_now timestamptz default now()
) returns table(
  account_id uuid, credential_id uuid, credential_revision bigint,
  factor_id uuid, secret_envelope text
)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_account_id uuid;
  v_challenge kova_private.auth_mfa_login_challenges;
  v_account kova_private.auth_accounts;
  v_checked uuid;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  select c.account_id into v_account_id
    from kova_private.auth_mfa_login_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;

  select * into v_account from kova_private.auth_accounts
   where id = v_account_id for update;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and account_id = v_account_id and consumed_at is null
     and expires_at > p_now and attempts < 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;

  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_challenge.session_epoch is distinct from v_account.session_epoch
    or v_challenge.created_at > p_now then
    raise exception 'kova_auth_account_unavailable';
  end if;

  if v_challenge.challenge_source = 'password' then
    select c.id into v_checked from kova_private.auth_credentials c
     where c.id = v_challenge.credential_id and c.account_id = v_account.id
       and c.revision = v_challenge.credential_revision
       and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null for share;
  elsif v_challenge.challenge_source = 'google' then
    select i.id into v_checked from kova_private.auth_identities i
     where i.id = v_challenge.google_identity_id and i.account_id = v_account.id
       and i.provider = 'google' and i.disabled_at is null
       and i.verified_at is not null
       and i.normalized_email = v_account.primary_email for share;
  else
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  if v_checked is null then raise exception 'kova_auth_account_unavailable'; end if;

  update kova_private.auth_mfa_login_challenges
     set attempts = attempts + 1
   where id = v_challenge.id;

  return query
    select v_challenge.account_id, v_challenge.credential_id,
      v_challenge.credential_revision, f.id,
      convert_from(f.secret_ciphertext, 'utf8')
      from kova_private.auth_mfa_factors f
     where f.account_id = v_account.id
       and f.factor_type = 'totp' and f.state = 'active'
       and f.verified_at is not null and f.disabled_at is null
     order by f.verified_at asc, f.created_at asc, f.id asc;
  if not found then raise exception 'kova_auth_mfa_migration_required'; end if;
end
$$;

revoke all on function public.kova_auth_read_mfa_login_challenge(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_read_mfa_login_challenge(text,timestamptz)
  to service_role;

create or replace function public.kova_auth_bind_mfa_login_factor(
  p_challenge_digest_hex text, p_factor_id uuid, p_now timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare
  v_account_id uuid;
  v_challenge kova_private.auth_mfa_login_challenges;
  v_account kova_private.auth_accounts;
  v_checked uuid;
begin
  if p_now is null or not isfinite(p_now) or p_factor_id is null then
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  select c.account_id into v_account_id
    from kova_private.auth_mfa_login_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;

  select * into v_account from kova_private.auth_accounts
   where id = v_account_id for update;
  select * into v_challenge from kova_private.auth_mfa_login_challenges
   where token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and account_id = v_account_id and consumed_at is null
     and expires_at > p_now and attempts between 1 and 5 for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_mfa_challenge'; end if;

  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or v_challenge.session_epoch is distinct from v_account.session_epoch
    or v_challenge.created_at > p_now then
    raise exception 'kova_auth_account_unavailable';
  end if;

  if v_challenge.challenge_source = 'password' then
    select c.id into v_checked from kova_private.auth_credentials c
     where c.id = v_challenge.credential_id and c.account_id = v_account.id
       and c.revision = v_challenge.credential_revision
       and c.credential_type = 'password'
       and c.activated_at is not null and c.disabled_at is null for share;
  elsif v_challenge.challenge_source = 'google' then
    select i.id into v_checked from kova_private.auth_identities i
     where i.id = v_challenge.google_identity_id and i.account_id = v_account.id
       and i.provider = 'google' and i.disabled_at is null
       and i.verified_at is not null
       and i.normalized_email = v_account.primary_email for share;
  else
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;
  if v_checked is null then raise exception 'kova_auth_account_unavailable'; end if;

  if not exists (
    select 1 from kova_private.auth_mfa_factors f
     where f.id = p_factor_id and f.account_id = v_account.id
       and f.factor_type = 'totp' and f.state = 'active'
       and f.verified_at is not null and f.disabled_at is null
  ) then
    raise exception 'kova_auth_invalid_mfa_challenge';
  end if;

  update kova_private.auth_mfa_login_challenges
     set factor_id = p_factor_id
   where id = v_challenge.id;
  return true;
end
$$;

revoke all on function public.kova_auth_bind_mfa_login_factor(text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_bind_mfa_login_factor(text,uuid,timestamptz)
  to service_role;

commit;
