-- REVIEW CANDIDATE ONLY. Not a release migration.
-- Run only on an isolated database, not on production or the retained rehearsal project.
-- Keep every existing RLS policy, function identity, grants and pre-request hook.
-- Do not delete auth records, revoke hosted sessions or alter signing keys.
-- This transaction deliberately rolls back even when every assertion passes.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';

do $preflight$
begin
  if to_regprocedure('kova_auth_guard.session_is_active()') is null
    or to_regclass('kova_private.auth_legacy_retirements') is null then
    raise exception 'Unexpected auth schema; abort';
  end if;
  if exists (
    select 1 from kova_private.auth_sessions
    where revoked_at is null and expires_at > now()
  ) then
    raise exception 'Active owned sessions require disposition; abort';
  end if;
end
$preflight$;

create or replace function kova_auth_guard.session_is_active()
returns boolean
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_raw text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_raw is null or v_raw = '' then return true; end if;
  if octet_length(v_raw) > 16384 then return false; end if;
  v_claims := v_raw::jsonb;
  if jsonb_typeof(v_claims) is distinct from 'object' then return false; end if;
  -- Reject every legacy signed authority marker, regardless of value.
  if v_claims ? 'kova_auth' then return false; end if;
  -- Preserve the existing hosted retirement fence until disposition is proved.
  if v_claims->>'role' = 'authenticated'
    and coalesce(v_claims->>'sub' ~ v_uuid_pattern, false) then
    return not exists (
      select 1 from kova_private.auth_legacy_retirements
      where account_id = (v_claims->>'sub')::uuid
    );
  end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$function$;

do $tests$
declare
  sample record;
begin
  for sample in
    select * from (values
      ('', true),
      ('{"role":"anon"}', true),
      ('{"role":"service_role"}', true),
      ('{"role":"authenticated","user_metadata":{"kova_auth":1}}', true),
      ('{"role":"authenticated","kova_auth":1}', false),
      ('{"kova_auth":null}', false),
      ('{"kova_auth":false}', false),
      ('[]', false),
      ('{malformed', false),
      (repeat('x', 16385), false)
    ) as cases(raw, expected)
  loop
    perform set_config('request.jwt.claims', sample.raw, true);
    if kova_auth_guard.session_is_active() is distinct from sample.expected then
      raise exception 'Session guard regression';
    end if;
  end loop;
end
$tests$;

-- Full hosted-user, two-user RLS, Storage, Realtime, notification and account
-- deletion acceptance remains mandatory before generating a forward migration.
rollback;
