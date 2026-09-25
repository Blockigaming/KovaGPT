-- Mailbox proof may be reissued without ever replacing a pending password.
-- Only the application service can invoke this operation. The public HTTP
-- response does not expose the returned queue/no-op decision.
create or replace function public.kova_auth_resend_verification(
  p_email text, p_verification_digest_hex text,
  p_expires_at timestamptz, p_email_payload jsonb,
  p_now timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_email text := lower(btrim(p_email));
  v_account kova_private.auth_accounts;
  v_identity_id uuid;
  v_created timestamptz;
begin
  if v_email is null or char_length(v_email) not between 3 and 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_now is null or not isfinite(p_now)
    or p_expires_at is null or not isfinite(p_expires_at)
    or p_expires_at <= p_now
    or p_expires_at > p_now + interval '1 hour'
    or jsonb_typeof(p_email_payload) is distinct from 'object'
    or pg_column_size(p_email_payload) > 16384 then
    raise exception 'kova_auth_invalid_verification';
  end if;
  perform kova_private.require_digest(p_verification_digest_hex);
  -- Match signup's mailbox lock, then take the authoritative account lock.
  perform pg_advisory_xact_lock(hashtextextended('kova_auth_email:' || v_email, 0));
  select * into v_account from kova_private.auth_accounts
   where primary_email = v_email for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is not null or v_account.mfa_required
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or not kova_private.legacy_principal_permitted(v_account.id)
    or kova_private.legacy_mfa_required(v_account.id) then return false; end if;
  select id into v_identity_id from kova_private.auth_identities
   where account_id = v_account.id and provider = 'email'
     and normalized_email = v_email and disabled_at is null and verified_at is null for share;
  if v_identity_id is null or not exists (
    select 1 from kova_private.auth_credentials where account_id = v_account.id
      and credential_type = 'password' and disabled_at is null and activated_at is null
  ) then return false; end if;
  select max(created_at) into v_created from kova_private.auth_email_verifications
   where account_id = v_account.id;
  if v_created is not null and v_created > p_now - interval '60 seconds' then return false; end if;
  if (select count(*) from kova_private.auth_email_verifications
    where account_id = v_account.id and created_at > p_now - interval '1 hour') >= 4 then return false; end if;
  if p_email_payload->>'to' is distinct from v_email
    or p_email_payload->>'label' is distinct from 'kova-auth-verification'
    or p_email_payload->>'purpose' is distinct from 'auth' then
    raise exception 'kova_auth_invalid_verification_payload';
  end if;
  update kova_private.auth_email_verifications set consumed_at = p_now
   where account_id = v_account.id and consumed_at is null;
  insert into kova_private.auth_email_verifications(
    account_id, identity_id, token_digest, expires_at, created_at
  ) values (v_account.id, v_identity_id, kova_private.require_digest(p_verification_digest_hex),
    p_expires_at, p_now);
  perform public.enqueue_email('auth_emails', p_email_payload);
  perform kova_private.audit(v_account.id, null, 'verification_resent', 'success', '{}', p_now);
  return true;
end
$$;
revoke all on function public.kova_auth_resend_verification(text,text,timestamptz,jsonb,timestamptz)
 from public, anon, authenticated;
grant execute on function public.kova_auth_resend_verification(text,text,timestamptz,jsonb,timestamptz)
 to service_role;

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
    v_existing_pending := public.kova_auth_resend_verification(
      v_email, p_verification_digest_hex, least(p_verification_expires_at, p_now + interval '1 hour'), p_email_payload, p_now);
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'rejected', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, v_existing_pending;
    return;
  end if;

  insert into kova_private.auth_credentials(
    account_id, credential_type, secret_hash, algorithm, activated_at, created_at, updated_at
  ) values (v_account_id, 'password', p_password_hash, 'scrypt-v1', null, p_now, p_now)
  on conflict (account_id) where credential_type = 'password' and disabled_at is null do nothing;
  if not found then
    v_existing_pending := public.kova_auth_resend_verification(
      v_email, p_verification_digest_hex, least(p_verification_expires_at, p_now + interval '1 hour'), p_email_payload, p_now);
    perform kova_private.audit(v_account_id, null, 'signup_pending_account', 'rejected', '{}', p_now);
    return query select v_account_id, v_account_id = p_candidate_account_id, v_existing_pending;
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
