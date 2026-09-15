-- Coordinate the public geocoder across every application instance. Nominatim
-- permits at most one application-wide request per second and asks clients to
-- cache results. Browser roles receive no access to either internal table.
create table if not exists public.maps_provider_throttle (
  singleton boolean primary key default true check (singleton),
  next_allowed_at timestamptz not null default '-infinity'::timestamptz
);

create table if not exists public.maps_search_cache (
  query_hash text primary key check (query_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.maps_provider_throttle enable row level security;
alter table public.maps_search_cache enable row level security;
revoke all on public.maps_provider_throttle, public.maps_search_cache from public, anon, authenticated;

create or replace function public.claim_maps_provider_request()
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := statement_timestamp();
  next_request timestamptz;
begin
  insert into public.maps_provider_throttle(singleton)
  values (true)
  on conflict (singleton) do nothing;

  select next_allowed_at into next_request
  from public.maps_provider_throttle
  where singleton = true
  for update;

  if next_request > v_now then
    return query select false, greatest(1, ceil(extract(epoch from next_request - v_now))::integer);
    return;
  end if;

  update public.maps_provider_throttle
  set next_allowed_at = v_now + interval '1 second'
  where singleton = true;
  return query select true, 1;
end;
$$;

create or replace function public.read_maps_search_cache(p_query_hash text)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  cached jsonb;
begin
  if p_query_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_maps_query_hash' using errcode = '22023';
  end if;
  select payload into cached
  from public.maps_search_cache
  where query_hash = p_query_hash and expires_at > statement_timestamp();
  return cached;
end;
$$;

create or replace function public.store_maps_search_cache(p_query_hash text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_query_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 262144
  then
    raise exception 'invalid_maps_cache_entry' using errcode = '22023';
  end if;

  insert into public.maps_search_cache(query_hash, payload, expires_at)
  values (p_query_hash, p_payload, statement_timestamp() + interval '24 hours')
  on conflict (query_hash) do update
  set payload = excluded.payload,
      expires_at = excluded.expires_at,
      created_at = statement_timestamp();

  delete from public.maps_search_cache where expires_at <= statement_timestamp();
end;
$$;

revoke all on function public.claim_maps_provider_request() from public, anon, authenticated;
revoke all on function public.read_maps_search_cache(text) from public, anon, authenticated;
revoke all on function public.store_maps_search_cache(text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_maps_provider_request() to service_role;
grant execute on function public.read_maps_search_cache(text) to service_role;
grant execute on function public.store_maps_search_cache(text, jsonb) to service_role;
