-- Kova controls these inert UUID bridges directly. They are NOT hosted login
-- identities. Existing auth.users foreign keys are deliberately retained until
-- their separate data-root migration is verified; no Auth HTTP API is needed.
begin;

create table kova_private.auth_compatibility_candidates (
  account_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table kova_private.auth_compatibility_candidates enable row level security;
revoke all on kova_private.auth_compatibility_candidates from public, anon, authenticated, service_role;

create function public.kova_auth_create_compatibility_principal()
returns uuid language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, banned_until, is_anonymous, created_at, updated_at)
  values (v_id, 'shadow+' || v_id || '@auth.invalid.kovagpt.com', null, null,
    '{"provider":"kova_shadow","providers":[]}'::jsonb, '{"kova_shadow":true}'::jsonb,
    'infinity'::timestamptz, false, now(), now());
  insert into kova_private.auth_compatibility_candidates(account_id) values(v_id);
  return v_id;
end
$$;

create function kova_private.adopt_compatibility_candidate()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  -- The inserted account's FK has already locked the UUID bridge. Cleanup also
  -- locks that parent first, so adoption and cleanup cannot delete one another.
  delete from kova_private.auth_compatibility_candidates where account_id = new.legacy_supabase_user_id;
  return new;
end
$$;
create trigger kova_adopt_compatibility_candidate after insert on kova_private.auth_accounts
  for each row execute function kova_private.adopt_compatibility_candidate();

create function public.kova_auth_delete_unused_compatibility_principal(p_account_id uuid)
returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_user auth.users;
begin
  if p_account_id is null then return false; end if;
  select * into v_user from auth.users where id = p_account_id for update;
  if not found then return true; end if;
  perform 1 from kova_private.auth_compatibility_candidates where account_id = p_account_id for update;
  if not found or
     v_user.email is distinct from 'shadow+' || p_account_id || '@auth.invalid.kovagpt.com' or
     v_user.encrypted_password is not null or v_user.email_confirmed_at is not null or
     v_user.raw_app_meta_data->>'provider' is distinct from 'kova_shadow' or
     v_user.banned_until is distinct from 'infinity'::timestamptz or
     exists(select 1 from kova_private.auth_accounts where id = p_account_id or legacy_supabase_user_id = p_account_id) or
     exists(select 1 from auth.identities where user_id = p_account_id) or
     exists(select 1 from auth.sessions where user_id = p_account_id) then
    return false;
  end if;
  delete from auth.users where id = p_account_id;
  return true;
end
$$;

create function public.kova_auth_has_verified_legacy_mfa(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select kova_private.legacy_mfa_required(p_account_id)
$$;

-- Recovery retires the old password and hosted refresh sessions in the SAME
-- transaction as consuming mailbox proof and installing the owned credential.
-- Any failure rolls all of them back, rather than stranding a half-reset user.
alter table kova_private.auth_password_recoveries add column account_epoch bigint;
alter table kova_private.auth_password_recoveries add column verified_email text;
-- Existing proofs have no trustworthy issuance binding; request them again
-- instead of backfilling authority the original token never proved.
update kova_private.auth_password_recoveries set consumed_at = coalesce(consumed_at, now())
 where account_epoch is null or verified_email is null;
create function kova_private.bind_recovery_account_authority()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_account kova_private.auth_accounts;
begin
  select * into v_account from kova_private.auth_accounts where id = new.account_id for update;
  if not found then raise exception 'kova_auth_account_unavailable'; end if;
  new.account_epoch := v_account.session_epoch;
  new.verified_email := v_account.primary_email;
  return new;
end
$$;
create trigger kova_bind_recovery_account_authority before insert on kova_private.auth_password_recoveries
 for each row execute function kova_private.bind_recovery_account_authority();

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
  if p_now is null or not isfinite(p_now) or p_session_expires_at is null or
     not isfinite(p_session_expires_at) or p_session_expires_at <= p_now or
     p_password_hash is null or char_length(p_password_hash) not between 64 and 2048 then
    raise exception 'kova_auth_invalid_recovery';
  end if;
  perform kova_private.require_digest(p_session_digest_hex);
  select r.account_id into v_account_id from kova_private.auth_password_recoveries r
   where r.token_digest = kova_private.require_digest(p_recovery_digest_hex);
  if v_account_id is null then raise exception 'kova_auth_invalid_recovery'; end if;
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
    raise exception 'kova_auth_account_unavailable';
  end if;
  select * into v_recovery from kova_private.auth_password_recoveries r
   where r.token_digest = kova_private.require_digest(p_recovery_digest_hex)
     and r.account_id = v_account.id and r.consumed_at is null and r.expires_at > p_now for update;
  if not found or v_recovery.account_epoch is distinct from v_account.session_epoch or
     v_recovery.verified_email is distinct from v_account.primary_email then
    raise exception 'kova_auth_invalid_recovery';
  end if;
  if v_account.mfa_required or kova_private.legacy_mfa_required(v_account.id) then
    raise exception 'kova_auth_mfa_migration_required';
  end if;
  if v_account.legacy_supabase_user_id is not null then
    update auth.users set encrypted_password = null, updated_at = p_now
      where id = v_account.legacy_supabase_user_id;
    if not found then raise exception 'kova_auth_account_unavailable'; end if;
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

-- Called only after the account API's existing external cleanup stages. This
-- keeps the current UUID-root cascade, but no longer calls the hosted Auth API.
create function public.kova_auth_finalize_account_deletion(p_account_id uuid, p_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare v_account kova_private.auth_accounts; v_session kova_private.auth_sessions;
begin
  if p_account_id is null or p_session_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 20260903204500));
  select * into v_account from kova_private.auth_accounts where id = p_account_id for update;
  if not found then
    return not exists(select 1 from auth.users where id = p_account_id);
  end if;
  if v_account.legacy_supabase_user_id is distinct from p_account_id or
     v_account.deleted_at is not null or v_account.email_verified_at is null or
     (v_account.suspended_until is not null and v_account.suspended_until > now()) or
     not exists(select 1 from public.account_deletion_fences f
       where f.user_id = p_account_id and f.started_at is not null) then return false; end if;
  select * into v_session from kova_private.auth_sessions s
    where s.id = p_session_id and s.account_id = p_account_id for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() or
     v_session.session_epoch is distinct from v_account.session_epoch or
     ((v_account.mfa_required or kova_private.legacy_mfa_required(p_account_id))
       and v_session.assurance_level <> 'aal2') or
     not exists(select 1 from kova_private.auth_identities i
       where i.account_id = p_account_id and i.verified_at is not null and i.disabled_at is null
         and i.normalized_email = v_account.primary_email) then return false; end if;
  delete from auth.users where id = p_account_id;
  if not found or exists(select 1 from kova_private.auth_accounts where id = p_account_id) then
    raise exception 'kova_auth_account_deletion_incomplete';
  end if;
  return true;
end
$$;
revoke all on function public.kova_auth_finalize_account_deletion(uuid,uuid) from public, anon, authenticated;
grant execute on function public.kova_auth_finalize_account_deletion(uuid,uuid) to service_role;

revoke all on function kova_private.adopt_compatibility_candidate() from public, anon, authenticated, service_role;
revoke all on function kova_private.bind_recovery_account_authority() from public, anon, authenticated, service_role;
revoke all on function public.kova_auth_create_compatibility_principal(),
  public.kova_auth_delete_unused_compatibility_principal(uuid),
  public.kova_auth_has_verified_legacy_mfa(uuid),
  public.kova_auth_consume_recovery(text,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.kova_auth_create_compatibility_principal(),
  public.kova_auth_delete_unused_compatibility_principal(uuid),
  public.kova_auth_has_verified_legacy_mfa(uuid),
  public.kova_auth_consume_recovery(text,text,text,timestamptz,timestamptz) to service_role;
commit;