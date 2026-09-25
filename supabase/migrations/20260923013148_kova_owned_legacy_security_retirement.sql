-- Preserve owned authority across legacy credential retirement and moderation.
-- UUID bridges remain for data continuity; this does not deploy or cut over Auth.
begin;
create table kova_private.auth_legacy_retirements (
  account_id uuid primary key,
  retired_at timestamptz not null default now()
);
-- No cascading FK: keep the non-secret denial marker after account erasure so
-- an already-issued hosted JWT cannot regain authority when credentials vanish.
alter table kova_private.auth_legacy_retirements enable row level security;
revoke all on kova_private.auth_legacy_retirements from public, anon, authenticated, service_role;

create function kova_private.legacy_principal_permitted(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select exists(select 1 from auth.users u where u.id=p_account_id and
    (coalesce(u.raw_app_meta_data->>'provider','')='kova_shadow' or
     (u.deleted_at is null and not coalesce(u.is_anonymous,false) and
      (u.banned_until is null or u.banned_until <= statement_timestamp()))))
$$;
revoke all on function kova_private.legacy_principal_permitted(uuid) from public, anon, authenticated, service_role;

create function kova_private.guard_legacy_adoption()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null and new.legacy_supabase_user_id is not null and
     not kova_private.legacy_principal_permitted(new.legacy_supabase_user_id) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  return new;
end
$$;
revoke all on function kova_private.guard_legacy_adoption() from public, anon, authenticated, service_role;
create trigger kova_guard_legacy_adoption before insert or update on kova_private.auth_accounts
 for each row execute function kova_private.guard_legacy_adoption();

create function kova_private.retire_legacy_auth(p_account_id uuid, p_now timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_account_id is null or p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_retirement';
  end if;
  insert into kova_private.auth_legacy_retirements(account_id,retired_at)
    values(p_account_id,p_now) on conflict(account_id) do nothing;
  update auth.users set encrypted_password=null, updated_at=p_now where id=p_account_id;
  delete from auth.sessions where user_id=p_account_id;
end
$$;
revoke all on function kova_private.retire_legacy_auth(uuid,timestamptz) from public, anon, authenticated, service_role;

create function kova_private.retire_password_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.credential_type='password' and new.activated_at is not null and
     (tg_op='INSERT' or old.activated_at is null or new.secret_hash is distinct from old.secret_hash
       or new.legacy_disabled_at is not null) then
    -- Credential mutations already hold the owning account lock. A failure in
    -- session rotation/auditing rolls back this trigger and hosted retirement.
    perform kova_private.retire_legacy_auth(new.account_id, new.updated_at);
    new.legacy_disabled_at := coalesce(new.legacy_disabled_at,new.updated_at);
  end if;
  return new;
end
$$;
revoke all on function kova_private.retire_password_authority() from public, anon, authenticated, service_role;
create trigger kova_retire_password_authority before insert or update on kova_private.auth_credentials
 for each row execute function kova_private.retire_password_authority();
insert into kova_private.auth_legacy_retirements(account_id,retired_at)
 select account_id,min(legacy_disabled_at) from kova_private.auth_credentials
 where legacy_disabled_at is not null group by account_id on conflict do nothing;

create function public.kova_auth_legacy_session_allowed(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select kova_private.legacy_principal_permitted(p_account_id)
    and not exists(select 1 from kova_private.auth_legacy_retirements where account_id=p_account_id)
    and not exists(select 1 from kova_private.auth_accounts a where a.id=p_account_id and
      (a.deleted_at is not null or a.suspended_until > statement_timestamp()))
$$;
revoke all on function public.kova_auth_legacy_session_allowed(uuid) from public, anon, authenticated;
grant execute on function public.kova_auth_legacy_session_allowed(uuid) to service_role;

create or replace function kova_auth_guard.session_is_active() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_raw text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_now timestamptz := statement_timestamp();
  v_seconds numeric := extract(epoch from v_now);
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Preserve hosted/anonymous/service access during the separately gated
  -- migration. The Kova signer always supplies this signed, top-level marker.
  -- Do not inspect user_metadata to decide which authority a token belongs to.
  if v_raw is null or v_raw = '' then return true; end if;
  if octet_length(v_raw) > 16384 then return false; end if;
  v_claims := v_raw::jsonb;
  if jsonb_typeof(v_claims) is distinct from 'object' then return false; end if;
  if not (v_claims ? 'kova_auth') then
    if v_claims->>'role' = 'authenticated' and
       coalesce(v_claims->>'sub' ~ v_uuid_pattern,false) then
      return not exists(select 1 from kova_private.auth_legacy_retirements
        where account_id=(v_claims->>'sub')::uuid);
    end if;
    return true;
  end if;
  if v_claims->'kova_auth' is distinct from '1'::jsonb
    or v_claims->>'role' is distinct from 'authenticated'
    or v_claims->>'aud' is distinct from 'authenticated'
    or v_claims->'email_verified' is distinct from 'true'::jsonb
    or jsonb_typeof(v_claims->'sub') is distinct from 'string'
    or jsonb_typeof(v_claims->'session_id') is distinct from 'string'
    or not coalesce(v_claims->>'sub' ~ v_uuid_pattern, false)
    or not coalesce(v_claims->>'session_id' ~ v_uuid_pattern, false)
    or jsonb_typeof(v_claims->'email') is distinct from 'string'
    or jsonb_typeof(v_claims->'aal') is distinct from 'string'
    or jsonb_typeof(v_claims->'iat') is distinct from 'number'
    or jsonb_typeof(v_claims->'exp') is distinct from 'number'
    or not coalesce(v_claims->>'iat' ~ '^[0-9]{1,12}$', false)
    or not coalesce(v_claims->>'exp' ~ '^[0-9]{1,12}$', false) then
    return false;
  end if;
  if (v_claims->>'iat')::numeric > v_seconds + 5
    or (v_claims->>'exp')::numeric <= v_seconds
    or (v_claims->>'exp')::numeric <= (v_claims->>'iat')::numeric
    or (v_claims->>'exp')::numeric > (v_claims->>'iat')::numeric + 300 then
    return false;
  end if;
  return exists (
    select 1 from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
    where s.id = (v_claims->>'session_id')::uuid
      and a.id = (v_claims->>'sub')::uuid
      and s.revoked_at is null and s.created_at <= v_now and s.expires_at > v_now
      and s.session_epoch = a.session_epoch
      and s.assurance_level = v_claims->>'aal'
      and a.primary_email = v_claims->>'email'
      and a.email_verified_at is not null and a.deleted_at is null
      and (a.legacy_supabase_user_id is null or kova_private.legacy_principal_permitted(a.legacy_supabase_user_id))
      and (a.suspended_until is null or a.suspended_until <= v_now)
      and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id))
           or s.assurance_level = 'aal2')
      and (v_claims->>'iat')::numeric >= floor(extract(epoch from s.created_at)) - 5
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$$;

create or replace function public.kova_auth_resolve_session(p_token_digest_hex text, p_now timestamptz default now())
returns table(
  session_id uuid, account_id uuid, email text, display_name text,
  email_verified boolean, assurance_level text, expires_at timestamptz
) language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select s.id, a.id, a.primary_email, a.display_name, a.email_verified_at is not null,
    s.assurance_level, s.expires_at
    from kova_private.auth_sessions s join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_token_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and (a.legacy_supabase_user_id is null or kova_private.legacy_principal_permitted(a.legacy_supabase_user_id))
     and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
     and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id)) or s.assurance_level = 'aal2')
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


create function kova_private.guard_session_legacy_principal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_legacy uuid;
begin
  select legacy_supabase_user_id into v_legacy from kova_private.auth_accounts where id=new.account_id;
  if v_legacy is not null and not kova_private.legacy_principal_permitted(v_legacy) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  return new;
end
$$;
revoke all on function kova_private.guard_session_legacy_principal() from public, anon, authenticated, service_role;
create trigger kova_guard_session_legacy_principal before insert on kova_private.auth_sessions
 for each row execute function kova_private.guard_session_legacy_principal();

create or replace function kova_private.lock_auth_session(
  p_session_digest_hex text, p_now timestamptz
) returns kova_private.auth_sessions
language plpgsql security invoker set search_path = '' as $$
declare
  v_account_id uuid;
  v_account kova_private.auth_accounts;
  v_session kova_private.auth_sessions;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception 'kova_auth_invalid_session';
  end if;
  select s.account_id into v_account_id from kova_private.auth_sessions s
   where s.token_digest = kova_private.require_digest(p_session_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_account from kova_private.auth_accounts
   where id = v_account_id for update;
  select * into v_session from kova_private.auth_sessions
   where token_digest = kova_private.require_digest(p_session_digest_hex)
     and account_id = v_account_id for update;
  if v_account.id is null or v_account.deleted_at is not null
    or v_account.email_verified_at is null
    or (v_account.suspended_until is not null and v_account.suspended_until > p_now)
    or (v_account.legacy_supabase_user_id is not null and not kova_private.legacy_principal_permitted(v_account.legacy_supabase_user_id))
    or v_session.id is null or v_session.revoked_at is not null
    or v_session.expires_at <= p_now or v_session.created_at > p_now
    or v_session.session_epoch <> v_account.session_epoch
    or ((v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id))
      and v_session.assurance_level <> 'aal2') then
    raise exception 'kova_auth_invalid_session';
  end if;
  return v_session;
end
$$;

-- Background exports read an allowlisted owned identity, not the hosted Auth
-- administration API and never a private credential/session row.
create function public.kova_auth_export_identity(p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_account kova_private.auth_accounts;
begin
 select * into v_account from kova_private.auth_accounts where id=p_account_id;
 if not found then return null; end if;
 if public.kova_auth_directory_email(p_account_id) is null then
   raise exception 'kova_auth_account_unavailable';
 end if;
 return jsonb_build_object('id',v_account.id,'email',v_account.primary_email,
   'email_confirmed_at',v_account.email_verified_at,'created_at',v_account.created_at,
   'updated_at',v_account.updated_at,
   'app_metadata',jsonb_build_object('provider','kova','providers',jsonb_build_array('kova')),
   'user_metadata',jsonb_build_object('full_name',v_account.display_name),
   'identities',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'provider',i.provider,
      'identity_data',jsonb_build_object('email',i.normalized_email,'email_verified',i.verified_at is not null)) order by i.id)
     from kova_private.auth_identities i where i.account_id=p_account_id and i.disabled_at is null),'[]'::jsonb));
end
$$;
revoke all on function public.kova_auth_export_identity(uuid) from public, anon, authenticated;
grant execute on function public.kova_auth_export_identity(uuid) to service_role;

commit;
