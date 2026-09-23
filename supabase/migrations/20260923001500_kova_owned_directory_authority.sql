-- Source-only retirement follow-up. A Kova account is authoritative even when
-- unavailable; its stale hosted email must never become a fallback identity.
begin;
create or replace function public.kova_auth_directory_email(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_account kova_private.auth_accounts;
  v_email text;
begin
  select * into v_account from kova_private.auth_accounts where id = p_account_id;
  if found then
    if v_account.deleted_at is not null
       or v_account.email_verified_at is null
       or (v_account.suspended_until is not null and v_account.suspended_until > now())
       or exists (
         select 1 from auth.users u where u.id = v_account.legacy_supabase_user_id
          and coalesce(to_jsonb(u)->'raw_app_meta_data'->>'provider', '') <> 'kova_shadow'
          and (u.deleted_at is not null
            or coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
            or (to_jsonb(u)->>'banned_until')::timestamptz > now())
       )
       or not exists (
         select 1 from kova_private.auth_identities i
          where i.account_id = v_account.id
            and i.normalized_email = v_account.primary_email
            and i.verified_at is not null and i.disabled_at is null
       ) then
      return null;
    end if;
    return v_account.primary_email;
  end if;

  -- Hosted-only accounts retain their existing verification, suspension and
  -- anonymous-account exclusions. Never publish an orphaned shadow address.
  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = p_account_id
     and u.email_confirmed_at is not null and u.deleted_at is null
     and ((to_jsonb(u)->>'banned_until')::timestamptz is null
       or (to_jsonb(u)->>'banned_until')::timestamptz <= now())
     and coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) is false
     and coalesce(to_jsonb(u)->'raw_app_meta_data'->>'provider', '') <> 'kova_shadow'
     and coalesce(to_jsonb(u)->'raw_user_meta_data'->>'kova_shadow', '') <> 'true'
     and lower(btrim(u.email)) not like 'shadow+%@auth.invalid.kovagpt.com';
  return v_email;
end
$$;

create or replace function kova_private.verified_auth_user_for_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_count bigint;
begin
  if v_email is null or char_length(v_email) not between 3 and 320 then return null; end if;
  with candidates as (
    select a.id from kova_private.auth_accounts a where a.primary_email = v_email
    union
    select u.id from auth.users u
     where lower(btrim(u.email)) = v_email
       and not exists (select 1 from kova_private.auth_accounts a where a.id = u.id)
  )
  select (array_agg(c.id))[1], count(*) into v_id, v_count
    from candidates c
   where public.kova_auth_directory_email(c.id) = v_email;
  if v_count <> 1 then return null; end if;
  return v_id;
end
$$;

revoke all on function public.kova_auth_directory_email(uuid),
  kova_private.verified_auth_user_for_email(text) from public, anon, authenticated;
grant execute on function public.kova_auth_directory_email(uuid),
  kova_private.verified_auth_user_for_email(text) to service_role;

-- Product admission uses owned account state, never the deliberately disabled
-- hosted bridge. Hosted-only callers retain each original verification rule.
create function kova_private.auth_account_available(p_user uuid, p_require_verified boolean)
returns boolean language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_user is null or p_require_verified is null then return false; end if;
  if exists(select 1 from kova_private.auth_accounts where id = p_user) then
    return public.kova_auth_directory_email(p_user) is not null;
  end if;
  return exists(select 1 from auth.users u where u.id = p_user and u.deleted_at is null
    and (not p_require_verified or u.email_confirmed_at is not null)
    and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
    and ((to_jsonb(u)->>'banned_until')::timestamptz is null or
      (to_jsonb(u)->>'banned_until')::timestamptz <= now())
    and coalesce(to_jsonb(u)->'raw_app_meta_data'->>'provider','') <> 'kova_shadow'
    and lower(btrim(u.email)) not like 'shadow+%@auth.invalid.kovagpt.com');
end
$$;
revoke all on function kova_private.auth_account_available(uuid,boolean) from public, anon, authenticated;
grant execute on function kova_private.auth_account_available(uuid,boolean) to service_role;

-- Optional product schemas may be absent in an auth-only rehearsal. For every
-- installed function, require its exact reviewed previous body before replacing
-- ONLY its identity predicate. Preserve deletion, moderation and Lockdown gates.
do $upgrade$
begin
  if to_regprocedure('kova_private.organization_scim_actor_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.organization_scim_actor_current(uuid)'::regprocedure) is distinct from $previous$
 SELECT uid IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND(banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid) AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=uid AND settings IS NOT NULL AND(jsonb_typeof(settings)<>'object' OR coalesce(settings->>'lockdown_mode','false')<>'false'))
$previous$ then
      raise exception 'kova_directory_predicate_drift: organization_scim_actor_current';
    end if;
    execute $replacement$create or replace function kova_private.organization_scim_actor_current(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT uid IS NOT NULL AND kova_private.auth_account_available(uid, true)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid) AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=uid AND settings IS NOT NULL AND(jsonb_typeof(settings)<>'object' OR coalesce(settings->>'lockdown_mode','false')<>'false'))
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.custom_kova_principal_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.custom_kova_principal_current(uuid)'::regprocedure) is distinct from $previous$
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND (banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$previous$ then
      raise exception 'kova_directory_predicate_drift: custom_kova_principal_current';
    end if;
    execute $replacement$create or replace function kova_private.custom_kova_principal_current(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT kova_private.auth_account_available(p_user, true)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.web_push_identity_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.web_push_identity_current(uuid)'::regprocedure) is distinct from $previous$
 SELECT uid IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND(banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid)
$previous$ then
      raise exception 'kova_directory_predicate_drift: web_push_identity_current';
    end if;
    execute $replacement$create or replace function kova_private.web_push_identity_current(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT uid IS NOT NULL AND kova_private.auth_account_available(uid, true)
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid)
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.chat_history_principal_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.chat_history_principal_current(uuid)'::regprocedure) is distinct from $previous$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_owner AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_owner)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner);
$previous$ then
      raise exception 'kova_directory_predicate_drift: chat_history_principal_current';
    end if;
    execute $replacement$create or replace function kova_private.chat_history_principal_current(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT kova_private.auth_account_available(p_owner, false)
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_owner)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner);
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.workflow_skill_principal_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.workflow_skill_principal_current(uuid)'::regprocedure) is distinct from $previous$
  select p_user_id is not null
    and exists (
      select 1 from auth.users
      where id = p_user_id
        and deleted_at is null
        and email_confirmed_at is not null
        and not coalesce(is_anonymous, false)
        and (banned_until is null or banned_until <= now())
    )
    and not exists (
      select 1 from public.account_deletion_fences where user_id = p_user_id
    )
    and not exists (
      select 1 from public.banned_users where user_id = p_user_id
    );
$previous$ then
      raise exception 'kova_directory_predicate_drift: workflow_skill_principal_current';
    end if;
    execute $replacement$create or replace function kova_private.workflow_skill_principal_current(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and kova_private.auth_account_available(p_user_id, true)
    and not exists (
      select 1 from public.account_deletion_fences where user_id = p_user_id
    )
    and not exists (
      select 1 from public.banned_users where user_id = p_user_id
    );
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.mcp_owner_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.mcp_owner_current(uuid)'::regprocedure) is distinct from $previous$
 select exists(select 1 from auth.users where id=p_owner and deleted_at is null and email_confirmed_at is not null
  and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 and not exists(select 1 from public.account_deletion_fences where user_id=p_owner)
 and not exists(select 1 from public.banned_users where user_id=p_owner)
 and not exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false));
$previous$ then
      raise exception 'kova_directory_predicate_drift: mcp_owner_current';
    end if;
    execute $replacement$create or replace function kova_private.mcp_owner_current(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select kova_private.auth_account_available(p_owner, true)
 and not exists(select 1 from public.account_deletion_fences where user_id=p_owner)
 and not exists(select 1 from public.banned_users where user_id=p_owner)
 and not exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false));
$$;$replacement$;
  end if;
end
$upgrade$;
do $upgrade$
begin
  if to_regprocedure('kova_private.site_principal_current(uuid)') is not null then
    if (select prosrc from pg_proc where oid = 'kova_private.site_principal_current(uuid)'::regprocedure) is distinct from $previous$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.deleted_at IS NULL
  AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=now()))
  AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
  AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$previous$ then
      raise exception 'kova_directory_predicate_drift: site_principal_current';
    end if;
    execute $replacement$create or replace function kova_private.site_principal_current(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT kova_private.auth_account_available(p_user, true)
  AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
  AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$$;$replacement$;
  end if;
end
$upgrade$;
commit;