-- LOCAL ADDITIVE CANDIDATE ONLY. No remote execution or provider delivery.
-- Preserve existing queue transaction, account UUID, credential and deletion
-- authority. Reconcile copied function predicates with current Terminal source.
begin;

-- A retry or replacement request issues a new proof; it must not receive an
-- unbounded validity period because a service RPC omitted its HTTP-side bound.
-- Existing rows are not rewritten, and ordinary consumption updates are not
-- blocked by an insert-time validity guard.
create function kova_private.guard_email_action_proof_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.created_at is null or not isfinite(new.created_at)
    or new.expires_at is null or not isfinite(new.expires_at)
    or new.expires_at <= new.created_at
    or new.expires_at > new.created_at + interval '1 hour' then
    raise exception 'kova_auth_invalid_action_window';
  end if;
  return new;
end
$$;
revoke all on function kova_private.guard_email_action_proof_window()
  from public, anon, authenticated, service_role;
create trigger kova_guard_verification_proof_window
  before insert on kova_private.auth_email_verifications
  for each row execute function kova_private.guard_email_action_proof_window();
create trigger kova_guard_recovery_proof_window
  before insert on kova_private.auth_password_recoveries
  for each row execute function kova_private.guard_email_action_proof_window();

-- Match resend/recovery/security mutation lock order: account before proof.
-- Mailbox possession proves only the exact still-enabled current email identity.
create or replace function public.kova_auth_consume_verification(
  p_verification_digest_hex text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_challenge kova_private.auth_email_verifications;
  v_account kova_private.auth_accounts;
  v_account_id uuid; v_identity_id uuid; v_credential_id uuid; v_session_id uuid;
begin
  if p_now is null or not isfinite(p_now)
    or p_session_expires_at is null or not isfinite(p_session_expires_at)
    or p_session_expires_at <= p_now then
    raise exception 'kova_auth_invalid_session' using errcode = 'KVA01';
  end if;
  if p_verification_digest_hex is null or p_verification_digest_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'kova_auth_invalid_verification' using errcode = 'KVA01';
  end if;
  perform kova_private.require_digest(p_session_digest_hex);
  select e.account_id into v_account_id from kova_private.auth_email_verifications e
   where e.token_digest = kova_private.require_digest(p_verification_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_verification' using errcode = 'KVA01'; end if;
  select * into v_account from kova_private.auth_accounts a
   where a.id = v_account_id for update;
  if not found or v_account.deleted_at is not null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or (v_account.legacy_supabase_user_id is not null and
      not kova_private.legacy_principal_permitted(v_account.legacy_supabase_user_id)) then
    raise exception 'kova_auth_account_unavailable' using errcode = 'KVA01';
  end if;
  select * into v_challenge from kova_private.auth_email_verifications e
   where e.account_id = v_account.id
     and e.token_digest = kova_private.require_digest(p_verification_digest_hex)
     and e.consumed_at is null and e.created_at <= p_now and e.expires_at > p_now
     and isfinite(e.created_at) and isfinite(e.expires_at)
     and e.expires_at <= e.created_at + interval '1 hour' for update;
  if not found then raise exception 'kova_auth_invalid_verification' using errcode = 'KVA01'; end if;
  select i.id into v_identity_id from kova_private.auth_identities i
   where i.id = v_challenge.identity_id and i.account_id = v_account.id
     and i.provider = 'email' and i.disabled_at is null
     and i.normalized_email = v_account.primary_email for share;
  if v_identity_id is null then raise exception 'kova_auth_invalid_verification' using errcode = 'KVA01'; end if;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  select c.id into v_credential_id from kova_private.auth_credentials c
   where c.account_id = v_account.id and c.credential_type = 'password'
     and c.disabled_at is null for update;
  if v_credential_id is null then raise exception 'kova_auth_invalid_verification' using errcode = 'KVA01'; end if;
  update kova_private.auth_accounts set
    email_verified_at = coalesce(email_verified_at, p_now), updated_at = p_now
   where id = v_account.id returning * into v_account;
  update kova_private.auth_identities set
    verified_at = coalesce(verified_at, p_now), updated_at = p_now where id = v_identity_id;
  update kova_private.auth_credentials set
    activated_at = coalesce(activated_at, p_now), updated_at = p_now where id = v_credential_id;
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

-- This read-only lookup is not authentication; it filters expired, future-created
-- or authority-invalidated proof rows before consumption. HTTP may perform its
-- bounded password work before this lookup; SQL does not change that ordering.
create or replace function public.kova_auth_recovery_target(
  p_recovery_digest_hex text, p_now timestamptz default now()
) returns uuid language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select r.account_id from kova_private.auth_password_recoveries r
    join kova_private.auth_accounts a on a.id = r.account_id
   where r.token_digest = kova_private.require_digest(p_recovery_digest_hex)
     and p_now is not null and isfinite(p_now)
     and r.consumed_at is null and r.created_at <= p_now and r.expires_at > p_now
     and isfinite(r.created_at) and isfinite(r.expires_at)
     and r.expires_at <= r.created_at + interval '1 hour'
     and r.account_epoch = a.session_epoch and r.verified_email = a.primary_email
     and a.deleted_at is null and a.email_verified_at is not null
     and (a.suspended_until is null or a.suspended_until <= p_now)
     and (a.legacy_supabase_user_id is null or
       kova_private.legacy_principal_permitted(a.legacy_supabase_user_id))
     and exists(select 1 from kova_private.auth_identities i
       where i.account_id = a.id and i.normalized_email = a.primary_email
         and i.verified_at is not null and i.disabled_at is null)
$$;


create or replace function public.kova_auth_consume_recovery(
  p_recovery_digest_hex text, p_password_hash text, p_session_digest_hex text,
  p_session_expires_at timestamptz, p_now timestamptz default now()
) returns table(
  account_id uuid, session_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz
) language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_recovery kova_private.auth_password_recoveries;
  v_account kova_private.auth_accounts;
  v_account_id uuid;
  v_session_id uuid;
begin
  if p_recovery_digest_hex is null or p_recovery_digest_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'kova_auth_invalid_recovery' using errcode = 'KVA01';
  end if;
  if p_now is null or not isfinite(p_now) or p_session_expires_at is null or
     not isfinite(p_session_expires_at) or p_session_expires_at <= p_now or
     p_password_hash is null or char_length(p_password_hash) not between 64 and 2048 then
    raise exception 'kova_auth_invalid_recovery' using errcode = 'KVA01';
  end if;
  perform kova_private.require_digest(p_session_digest_hex);
  select r.account_id into v_account_id from kova_private.auth_password_recoveries r
   where r.token_digest = kova_private.require_digest(p_recovery_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_recovery' using errcode = 'KVA01'; end if;
  -- All owned credential mutations serialize through the account before tokens.
  select * into v_account from kova_private.auth_accounts where id = v_account_id for update;
  if not found or v_account.deleted_at is not null or v_account.email_verified_at is null or
     (v_account.suspended_until is not null and v_account.suspended_until > p_now) or
     exists(select 1 from auth.users u where u.id = v_account.legacy_supabase_user_id
       and coalesce(u.raw_app_meta_data->>'provider','') <> 'kova_shadow'
       and (u.deleted_at is not null or coalesce(u.is_anonymous,false)
         or (u.banned_until is not null and u.banned_until > p_now))) or
     not exists(select 1 from kova_private.auth_identities i where i.account_id = v_account.id
       and i.normalized_email = v_account.primary_email and i.verified_at is not null and i.disabled_at is null) then
    raise exception 'kova_auth_account_unavailable' using errcode = 'KVA01';
  end if;
  select * into v_recovery from kova_private.auth_password_recoveries r
   where r.token_digest = kova_private.require_digest(p_recovery_digest_hex)
     and r.account_id = v_account.id and r.consumed_at is null
     and r.created_at <= p_now and r.expires_at > p_now
     and isfinite(r.created_at) and isfinite(r.expires_at)
     and r.expires_at <= r.created_at + interval '1 hour' for update;
  if not found or v_recovery.account_epoch is distinct from v_account.session_epoch or
     v_recovery.verified_email is distinct from v_account.primary_email then
    raise exception 'kova_auth_invalid_recovery' using errcode = 'KVA01';
  end if;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  if v_account.legacy_supabase_user_id is not null then
    update auth.users set encrypted_password = null, updated_at = p_now
      where id = v_account.legacy_supabase_user_id;
    if not found then raise exception 'kova_auth_account_unavailable' using errcode = 'KVA01'; end if;
    delete from auth.sessions where user_id = v_account.legacy_supabase_user_id;
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
  update kova_private.auth_accounts set session_epoch = session_epoch + 1, updated_at = p_now
   where id = v_account.id returning * into v_account;
  update kova_private.auth_sessions set revoked_at = coalesce(revoked_at, p_now)
   where account_id = v_account.id and revoked_at is null;
  insert into kova_private.auth_sessions(
    account_id, token_digest, assurance_level, session_epoch, expires_at, created_at, last_seen_at
  ) values (v_account.id, kova_private.require_digest(p_session_digest_hex), 'aal1',
    v_account.session_epoch, p_session_expires_at, p_now, p_now) returning id into v_session_id;
  perform kova_private.audit(v_account.id, v_session_id, 'password_recovered', 'success', '{}', p_now);
  return query select v_account.id, v_session_id, v_account.primary_email,
    true, 'aal1'::text, p_session_expires_at;
end
$$;

commit;
