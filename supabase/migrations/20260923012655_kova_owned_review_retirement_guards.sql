-- Source-only security follow-up. No provider or deployment configuration changes.
begin;

-- Older recovery URLs and handoffs were issued without the new browser/fragment
-- boundary. Do not retroactively grant those tokens the new protocol's authority.
update kova_private.auth_password_recoveries
 set consumed_at = greatest(now(), created_at) where consumed_at is null;
update kova_private.auth_session_handoffs
 set consumed_at = greatest(now(), created_at) where consumed_at is null;

create function kova_private.guard_legacy_account_adoption()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_user auth.users; v_now timestamptz := coalesce(new.updated_at, now());
begin
  if new.legacy_supabase_user_id is null then return new; end if;
  select * into v_user from auth.users where id = new.legacy_supabase_user_id for share;
  if not found or v_user.deleted_at is not null or coalesce(v_user.is_anonymous, false) then
    raise exception 'kova_auth_account_unavailable';
  end if;
  if coalesce(v_user.raw_app_meta_data->>'provider','') = 'kova_shadow' then
    -- A deliberately banned inert bridge is not a banned real legacy account.
    -- Its shape and custody must still be exactly the Kova-created contract.
    if v_user.email is distinct from ('shadow+' || new.id::text || '@auth.invalid.kovagpt.com')
       or v_user.encrypted_password is not null or v_user.email_confirmed_at is not null
       or v_user.banned_until is distinct from 'infinity'::timestamptz
       or exists(select 1 from auth.identities where user_id = new.id)
       or exists(select 1 from auth.sessions where user_id = new.id)
       or not (exists(select 1 from kova_private.auth_compatibility_candidates where account_id = new.id)
         or exists(select 1 from kova_private.auth_accounts where id = new.id and legacy_supabase_user_id = new.id)) then
      raise exception 'kova_auth_account_unavailable';
    end if;
  elsif v_user.banned_until is not null and v_user.banned_until > v_now then
    raise exception 'kova_auth_account_unavailable';
  end if;
  return new;
end
$$;
create trigger kova_guard_legacy_account_adoption
 before insert or update of legacy_supabase_user_id, email_verified_at on kova_private.auth_accounts
 for each row execute function kova_private.guard_legacy_account_adoption();

-- Credential retirement participates in the calling SQL transaction. A later
-- session/audit failure therefore restores both authorities, never half a reset.
create function kova_private.retire_legacy_password_on_owned_change()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_legacy uuid; v_now timestamptz := coalesce(new.updated_at, now());
begin
  if new.credential_type <> 'password' or new.activated_at is null or new.disabled_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.activated_at is not null and new.secret_hash is not distinct from old.secret_hash then return new; end if;
  select legacy_supabase_user_id into v_legacy from kova_private.auth_accounts where id = new.account_id for update;
  if not found then raise exception 'kova_auth_account_unavailable'; end if;
  if v_legacy is not null then
    update auth.users set encrypted_password = null, updated_at = v_now where id = v_legacy;
    if not found then raise exception 'kova_auth_account_unavailable'; end if;
    delete from auth.sessions where user_id = v_legacy;
    new.legacy_disabled_at := v_now;
  end if;
  return new;
end
$$;
create trigger kova_retire_legacy_password_on_owned_change
 before insert or update of secret_hash, activated_at on kova_private.auth_credentials
 for each row execute function kova_private.retire_legacy_password_on_owned_change();

-- A closed, credential-free identity projection for server workers and exports.
-- Finding an unavailable owned account is terminal, never a hosted fallback.
create function public.kova_auth_account_snapshot(
  p_account_id uuid, p_allow_legacy boolean, p_require_verified boolean
) returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_account kova_private.auth_accounts; v_user auth.users;
begin
  if p_account_id is null or p_allow_legacy is null or p_require_verified is null then return null; end if;
  select * into v_account from kova_private.auth_accounts where id = p_account_id;
  if found then
    if public.kova_auth_directory_email(p_account_id) is null then return null; end if;
    return jsonb_build_object('id',v_account.id,'email',v_account.primary_email,
      'email_confirmed_at',v_account.email_verified_at,'created_at',v_account.created_at,
      'updated_at',v_account.updated_at,'app_metadata',jsonb_build_object('provider','kova'),
      'user_metadata',jsonb_build_object('full_name',v_account.display_name));
  end if;
  if not p_allow_legacy or not kova_private.auth_account_available(p_account_id,p_require_verified) then return null; end if;
  select * into v_user from auth.users where id = p_account_id;
  return jsonb_build_object('id',v_user.id,'email',v_user.email,
    'email_confirmed_at',v_user.email_confirmed_at,'created_at',v_user.created_at,
    'updated_at',v_user.updated_at,'app_metadata',jsonb_build_object('provider','supabase'),
    'user_metadata',jsonb_build_object('full_name',v_user.raw_user_meta_data->>'full_name'));
end
$$;

revoke all on function kova_private.guard_legacy_account_adoption(),
  kova_private.retire_legacy_password_on_owned_change() from public, anon, authenticated, service_role;
revoke all on function public.kova_auth_account_snapshot(uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.kova_auth_account_snapshot(uuid,boolean,boolean) to service_role;
commit;
