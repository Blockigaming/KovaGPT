-- Serialize the public Nominatim integration across every application instance
-- and cache identical provider responses. These objects are service-role only.
create table if not exists public.maps_geocoder_provider_state (
  singleton boolean primary key default true check (singleton),
  next_request_at timestamptz not null default '-infinity',
  lease_token uuid
);

insert into public.maps_geocoder_provider_state (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.maps_geocoder_cache (
  cache_key text primary key check (char_length(cache_key) between 1 and 512),
  payload jsonb not null,
  expires_at timestamptz not null
);

create index if not exists maps_geocoder_cache_expires_at_idx
  on public.maps_geocoder_cache (expires_at);

alter table public.maps_geocoder_provider_state enable row level security;
alter table public.maps_geocoder_cache enable row level security;
revoke all on public.maps_geocoder_provider_state from public, anon, authenticated;
revoke all on public.maps_geocoder_cache from public, anon, authenticated;
grant select, insert, update, delete on public.maps_geocoder_cache to service_role;
grant select, update on public.maps_geocoder_provider_state to service_role;

create or replace function public.claim_maps_geocoder_provider_slot()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_token uuid := gen_random_uuid();
  v_claimed_token uuid;
begin
  -- Bound routine cleanup work while ensuring expired query/language entries do
  -- not accumulate forever. Only cache misses call this provider admission RPC.
  delete from public.maps_geocoder_cache
   where ctid in (
     select ctid
       from public.maps_geocoder_cache
      where expires_at <= clock_timestamp()
      order by expires_at
      limit 250
   );

  update public.maps_geocoder_provider_state
     -- The provider fetch has an eight-second timeout. A ten-second lease keeps
     -- requests serialized even if an instance dies before releasing its slot.
     set next_request_at = clock_timestamp() + interval '10 seconds',
         lease_token = v_claim_token
   where singleton = true
     and next_request_at <= clock_timestamp()
  returning lease_token into v_claimed_token;
  return v_claimed_token;
end;
$$;

revoke all on function public.claim_maps_geocoder_provider_slot() from public, anon, authenticated;
grant execute on function public.claim_maps_geocoder_provider_slot() to service_role;

create or replace function public.release_maps_geocoder_provider_slot(p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_released boolean := false;
begin
  update public.maps_geocoder_provider_state
     set next_request_at = clock_timestamp() + interval '1 second',
         lease_token = null
   where singleton = true
     and lease_token = p_claim_token
  returning true into v_released;
  return coalesce(v_released, false);
end;
$$;

revoke all on function public.release_maps_geocoder_provider_slot(uuid) from public, anon, authenticated;
grant execute on function public.release_maps_geocoder_provider_slot(uuid) to service_role;
