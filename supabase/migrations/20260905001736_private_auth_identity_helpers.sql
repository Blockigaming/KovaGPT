-- service_role intentionally cannot SELECT auth.users in canonical production.
-- These exact-purpose private helpers reveal only an existence bit or a verified
-- invitation recipient ID. No Auth table privilege is widened.
create schema if not exists kova_private;
revoke all on schema kova_private from public, anon;
grant usage on schema kova_private to service_role;

create function kova_private.auth_user_exists(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists(select 1 from auth.users where id = p_user_id and deleted_at is null);
end;
$$;

create function kova_private.verified_auth_user_for_email(p_email text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_count bigint;
begin
  if p_email is null or length(btrim(p_email)) not between 3 and 320 then return null; end if;
  select (array_agg(id))[1], count(*) into v_id,v_count from auth.users
  where lower(btrim(email)) = lower(btrim(p_email)) and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until <= now())
    and is_anonymous is not true;
  if v_count <> 1 then return null; end if;
  return v_id;
end;
$$;
revoke all on function kova_private.auth_user_exists(uuid),
  kova_private.verified_auth_user_for_email(text) from public,anon,authenticated;
grant execute on function kova_private.auth_user_exists(uuid),
  kova_private.verified_auth_user_for_email(text) to service_role;
