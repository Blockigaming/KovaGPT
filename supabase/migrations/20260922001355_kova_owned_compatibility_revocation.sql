-- Recheck the authoritative session for Kova-signed data-plane requests.
-- This schema is NOT an exposed API schema. Its only browser-executable
-- functions inspect the caller's gateway-verified claims and return bool/void;
-- they accept no account selector and expose no private auth rows or digests.
create schema kova_auth_guard;
revoke all on schema kova_auth_guard from public, anon, authenticated, service_role;
grant usage on schema kova_auth_guard to anon, authenticated, service_role;

create function kova_auth_guard.session_is_active() returns boolean
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
  if not (v_claims ? 'kova_auth') then return true; end if;
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
      and (a.suspended_until is null or a.suspended_until <= v_now)
      and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id))
           or s.assurance_level = 'aal2')
      and (v_claims->>'iat')::numeric >= floor(extract(epoch from s.created_at)) - 5
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$$;
revoke all on function kova_auth_guard.session_is_active() from public, anon, authenticated, service_role;
grant execute on function kova_auth_guard.session_is_active() to anon, authenticated, service_role;

-- PostgREST also needs this hook: SECURITY DEFINER RPCs and owner-executed
-- views may bypass RLS. The hook checks the token before invoking either.
create function kova_auth_guard.check_request() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if kova_auth_guard.session_is_active() is not true then
    raise sqlstate 'PT401' using message = 'Invalid or expired session.';
  end if;
end
$$;
revoke all on function kova_auth_guard.check_request() from public, anon, authenticated, service_role;
grant execute on function kova_auth_guard.check_request() to anon, authenticated, service_role;

-- Add restrictions, never replace existing ownership/authorization policies.
-- RLS-disabled tables (including the unrelated integration_providers finding)
-- and all private auth tables remain untouched. Only the documented Storage
-- buckets/objects and Realtime messages policy surfaces are managed here;
-- internal service tables (including vector/multipart metadata) are untouched.
do $$
declare v_table record;
begin
  for v_table in
    select n.nspname, c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and (n.nspname = 'public'
           or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
           or (n.nspname = 'realtime' and c.relname = 'messages'))
    order by n.nspname, c.relname
  loop
    execute format(
      'create policy kova_owned_session_guard on %I.%I as restrictive for all to anon, authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()))',
      v_table.nspname, v_table.relname
    );
  end loop;
end
$$;

-- Do not silently overwrite another request guard. Scope the role setting to
-- this database, and require the normal PostgREST role to already exist.
do $$
declare v_role oid; v_database oid;
begin
  select oid into v_role from pg_catalog.pg_roles where rolname = 'authenticator';
  select oid into v_database from pg_catalog.pg_database where datname = current_database();
  if v_role is null then raise exception 'kova_auth_missing_authenticator_role'; end if;
  if exists (
    select 1 from pg_catalog.pg_db_role_setting s
    cross join lateral unnest(s.setconfig) as setting
    where s.setrole in (0, v_role) and s.setdatabase in (0, v_database)
      and setting like 'pgrst.db_pre_request=%'
      and setting not in ('pgrst.db_pre_request=', 'pgrst.db_pre_request=kova_auth_guard.check_request')
  ) then raise exception 'kova_auth_existing_request_guard'; end if;
  execute format(
    'alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(), 'kova_auth_guard.check_request'
  );
end
$$;
notify pgrst, 'reload config';
