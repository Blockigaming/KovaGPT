-- Request counts are an operational cap, never a commercial cost or margin claim.
create table public.discovery_provider_days (
  day date primary key,
  requests integer not null default 0 check (requests >= 0)
);
create table public.discovery_usage_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  unique(user_id, day)
);
alter table public.discovery_provider_days enable row level security;
alter table public.discovery_usage_days enable row level security;
revoke all on public.discovery_provider_days, public.discovery_usage_days from public, anon, authenticated;
grant select, insert, update, delete on public.discovery_provider_days, public.discovery_usage_days to service_role;
-- Service-only account export reads this safe count-only projection; no search text is stored.
create view public.discovery_usage_export_records with (security_invoker=true) as
  select id,user_id,day,requests from public.discovery_usage_days;
revoke all on public.discovery_usage_export_records from public, anon, authenticated;
grant select on public.discovery_usage_export_records to service_role;
create function public.admit_discovery_request(p_owner uuid, p_user_limit integer, p_global_limit integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare d date := (clock_timestamp() at time zone 'UTC')::date;
  user_count integer; global_count integer;
begin
  if p_owner is null or p_user_limit is null or p_user_limit < 1 or p_user_limit > 1000 or p_global_limit is null or p_global_limit < 1 or p_global_limit > 100000 then
    raise exception 'discovery_configuration_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner) or exists(select 1 from public.banned_users where user_id=p_owner) then
    raise exception 'discovery_owner_unavailable';
  end if;
  if exists(select 1 from public.user_preferences where user_id=p_owner and settings->'lockdown_mode'='true'::jsonb) then
    raise exception 'discovery_lockdown';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('discovery:'||d::text,20260905040500));
  insert into public.discovery_provider_days(day) values(d) on conflict do nothing;
  insert into public.discovery_usage_days(user_id,day) values(p_owner,d) on conflict do nothing;
  select requests into global_count from public.discovery_provider_days where day=d for update;
  select requests into user_count from public.discovery_usage_days where user_id=p_owner and day=d for update;
  if global_count>=p_global_limit or user_count>=p_user_limit then return false; end if;
  update public.discovery_provider_days set requests=requests+1 where day=d;
  update public.discovery_usage_days set requests=requests+1 where user_id=p_owner and day=d;
  -- Count-only operational records have a seven-day retention window, bounded per admission.
  delete from public.discovery_usage_days where id in(select id from public.discovery_usage_days where day<d-7 order by day,id limit 100);
  delete from public.discovery_provider_days where day in(select day from public.discovery_provider_days where day<d-7 order by day limit 100);
  return true;
end $$;
revoke all on function public.admit_discovery_request(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.admit_discovery_request(uuid,integer,integer) to service_role;
-- Authenticated maintenance purges old operational counts even with discovery disabled.
create function public.expire_discovery_usage(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'discovery_limit_invalid'; end if;
  delete from public.discovery_usage_days where id in(select id from public.discovery_usage_days where day<(clock_timestamp() at time zone 'UTC')::date-7 order by day,id limit p_limit for update skip locked);
  get diagnostics n = row_count;
  delete from public.discovery_provider_days where day in(select day from public.discovery_provider_days where day<(clock_timestamp() at time zone 'UTC')::date-7 order by day limit p_limit for update skip locked);
  return n;
end $$;
revoke all on function public.expire_discovery_usage(integer) from public,anon,authenticated;
grant execute on function public.expire_discovery_usage(integer) to service_role;
