-- Auth Rehearsal 2026-09-30: a revoked owned JWT received a CDN HIT on
-- object.get_authenticated. A cached byte response never reaches Storage RLS.
-- Keep owned private bytes behind the existing no-store application delivery
-- routes, which revalidate the session and object both before and after reading.
-- Signing remains a fresh POST/RLS check; product routes keep its short-lived
-- capability internal and never return it to the browser. Existing signed URLs
-- remain subject to their separately verified lifetime/expiry boundary.
create function kova_auth_guard.storage_operation_is_safe() returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_raw text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_operation text := current_setting('storage.operation', true);
begin
  if v_raw is null or v_raw = '' then return true; end if;
  if octet_length(v_raw) > 16384 then return false; end if;
  v_claims := v_raw::jsonb;
  if jsonb_typeof(v_claims) is distinct from 'object' then return false; end if;
  if not (v_claims ? 'kova_auth') then return true; end if;
  if v_claims->'kova_auth' is distinct from '1'::jsonb then return false; end if;
  if v_operation like 'storage.%' then v_operation := substr(v_operation, 9); end if;
  -- Unknown/unset operations fail closed. Do not use an exclusion list: a new
  -- download, transformation or S3 route must not become an accidental bypass.
  return coalesce(v_operation = any(array[
    'object.list', 'object.list_v2',
    'object.get_authenticated_info', 'object.head_authenticated_info',
    'object.sign', 'object.sign_many',
    'object.upload', 'object.upload_update', 'object.upload_signed',
    'object.sign_upload_url', 'object.delete', 'object.delete_many',
    'object.copy', 'object.move'
  ]), false);
exception when invalid_text_representation then return false;
end
$$;
revoke all on function kova_auth_guard.storage_operation_is_safe() from public, anon, authenticated, service_role;
grant execute on function kova_auth_guard.storage_operation_is_safe() to anon, authenticated, service_role;

-- Add a restriction. Ownership and current-session policies remain in force.
-- Service roles, bucket policies, multipart/vector internals and Realtime are
-- unchanged. Empty operation context is not evidence of an internal service.
do $$ begin
  if to_regclass('storage.objects') is not null then
    create policy kova_owned_storage_cache_boundary on storage.objects
      as restrictive for select to anon, authenticated
      using ((select kova_auth_guard.storage_operation_is_safe()));
  end if;
end $$;
