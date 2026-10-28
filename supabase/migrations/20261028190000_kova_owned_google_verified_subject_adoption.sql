-- Match a newly verified Google subject to its hosted identity before retaining its stable application UUID.
-- Source-only until an explicitly guarded production migration.
create or replace function public.kova_auth_finish_google(
  p_candidate_account_id uuid, p_provider_subject text, p_email text,
  p_email_verified boolean, p_display_name text, p_handoff_digest_hex text,
  p_handoff_expires_at timestamptz, p_now timestamptz default now()
) returns table(account_id uuid, candidate_used boolean)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email)); v_account_id uuid; v_bound_id uuid; v_legacy_id uuid;
  v_hosted_subject_count integer; v_hosted_account_id uuid;
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
    -- The new Google ID token proves the provider subject and mailbox. A
    -- hosted UUID is adopted only when that same subject is already attached
    -- to one confirmed, non-anonymous hosted account at this mailbox.
    select count(distinct u.id), (array_agg(distinct u.id))[1]
      into v_hosted_subject_count, v_hosted_account_id
      from auth.identities h join auth.users u on u.id = h.user_id
     where h.provider = 'google' and h.provider_id = p_provider_subject
       and h.identity_data->>'sub' = p_provider_subject;
    if v_hosted_account_id is not null then
      perform 1 from auth.identities h where h.user_id = v_hosted_account_id
        and h.provider = 'google' and h.provider_id = p_provider_subject
        and h.identity_data->>'sub' = p_provider_subject for share;
      if not found then
        raise exception 'kova_auth_google_adoption_conflict' using errcode = 'KVA02';
      end if;
      perform 1 from auth.users u where u.id = v_hosted_account_id
        and lower(u.email) = v_email and u.email_confirmed_at is not null
        and u.deleted_at is null and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= p_now) for share;
      if not found then
        raise exception 'kova_auth_google_adoption_conflict' using errcode = 'KVA02';
      end if;
    end if;
    if v_hosted_subject_count > 1 or
       (v_hosted_subject_count = 1 and not exists (
         select 1 from auth.users u where u.id = v_hosted_account_id
           and lower(u.email) = v_email and u.email_confirmed_at is not null
           and u.deleted_at is null and not coalesce(u.is_anonymous, false)
           and (u.banned_until is null or u.banned_until <= p_now)
       )) then
      raise exception 'kova_auth_google_adoption_conflict' using errcode = 'KVA02';
    end if;
    if v_hosted_account_id is null then
      -- A pending, unverified Kova signup has not established account
      -- authority. A verified Google mailbox may claim it, and the pending
      -- password and email proof are retired below. Established accounts do
      -- not qualify for this path.
      select a.id into v_account_id from kova_private.auth_accounts a
       where a.primary_email = v_email and a.email_verified_at is null
         and a.deleted_at is null
         and exists (select 1 from kova_private.auth_identities i
           where i.account_id = a.id and i.provider = 'email'
             and i.verified_at is null and i.disabled_at is null)
         and not exists (select 1 from kova_private.auth_credentials c
           where c.account_id = a.id and c.activated_at is not null and c.disabled_at is null)
         and not exists (select 1 from kova_private.auth_sessions s
           where s.account_id = a.id and s.revoked_at is null);
    end if;
    -- An email match alone cannot link a fresh subject to an existing
    -- account. Duplicate hosted mailboxes also need explicit reconciliation.
    if exists (
      select 1 from auth.users u where lower(u.email) = v_email
        and u.deleted_at is null and u.id is distinct from v_hosted_account_id
        and u.id <> p_candidate_account_id
    ) or exists (
      select 1 from kova_private.auth_accounts a where a.primary_email = v_email
        and a.id is distinct from coalesce(v_hosted_account_id, v_account_id)
    ) then
      raise exception 'kova_auth_google_adoption_conflict' using errcode = 'KVA02';
    end if;
    v_legacy_id := v_hosted_account_id;
    if v_legacy_id is not null then
      select a.id into v_account_id from kova_private.auth_accounts a where a.id = v_legacy_id;
    end if;
  end if;
  if v_account_id is not null then
    select * into v_account from kova_private.auth_accounts where id = v_account_id for update;
    if v_account.id is null or v_account.deleted_at is not null
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
    if v_account.primary_email is distinct from v_email then
      if v_google.id is null or v_google.provider_subject is distinct from p_provider_subject or
         exists(select 1 from kova_private.auth_accounts a where a.primary_email=v_email and a.id<>v_account_id) or
         exists(select 1 from kova_private.auth_identities i where i.normalized_email=v_email and i.account_id<>v_account_id) or
         exists(select 1 from auth.users u where lower(u.email)=v_email and u.id<>v_account_id) then
        raise exception 'kova_auth_email_conflict';
      end if;
      update kova_private.auth_identities set normalized_email=v_email, provider_subject=v_email,
        verified_at=p_now, updated_at=p_now where account_id=v_account_id and provider='email'
        and normalized_email=v_account.primary_email and disabled_at is null;
      update kova_private.auth_accounts set primary_email=v_email,email_verified_at=p_now,
        session_epoch=session_epoch+1,updated_at=p_now where id=v_account_id;
      update kova_private.auth_sessions set revoked_at=coalesce(revoked_at,p_now) where account_id=v_account_id;
      update kova_private.auth_credentials set revision=revision+1,updated_at=p_now where account_id=v_account_id;
      update kova_private.auth_password_recoveries set consumed_at=coalesce(consumed_at,p_now) where account_id=v_account_id;
      update kova_private.auth_email_verifications set consumed_at=coalesce(consumed_at,p_now) where account_id=v_account_id;
      update kova_private.auth_mfa_login_challenges set consumed_at=coalesce(consumed_at,p_now) where account_id=v_account_id;
      update kova_private.auth_session_handoffs set consumed_at=coalesce(consumed_at,p_now) where account_id=v_account_id;
      perform kova_private.retire_legacy_auth(v_account_id,p_now);
      perform kova_private.audit(v_account_id,null,'google_email_changed','success','{}',p_now);
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
    where kova_private.auth_identities.account_id = excluded.account_id
      and kova_private.auth_identities.disabled_at is null
  returning kova_private.auth_identities.account_id into v_bound_id;
  if v_bound_id is distinct from v_account_id then
    raise exception 'kova_auth_google_adoption_conflict' using errcode = 'KVA02';
  end if;
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
