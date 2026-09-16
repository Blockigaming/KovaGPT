-- Cache identical geocoder responses for 24 hours without persisting raw
-- searched addresses in the cache key. This table is service-role only.
create table if not exists public.maps_geocoder_cache (
  cache_key text primary key check (cache_key ~ '^v1:[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null
);

create index if not exists maps_geocoder_cache_expires_idx
  on public.maps_geocoder_cache(expires_at);

alter table public.maps_geocoder_cache enable row level security;
revoke all on table public.maps_geocoder_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.maps_geocoder_cache to service_role;

-- Keep cache maintenance opportunistic and bounded. The statement-level
-- trigger runs after a cache write, deletes at most 250 expired entries, and
-- does not participate in provider admission.
create or replace function public.prune_maps_geocoder_cache_expired()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  delete from public.maps_geocoder_cache
  where cache_key in (
    select cache_key
    from public.maps_geocoder_cache
    where expires_at <= statement_timestamp()
    order by expires_at
    limit 250
  );
  return null;
end;
$$;

drop trigger if exists maps_geocoder_cache_prune_expired on public.maps_geocoder_cache;
create trigger maps_geocoder_cache_prune_expired
after insert on public.maps_geocoder_cache
for each statement execute function public.prune_maps_geocoder_cache_expired();

revoke all on function public.prune_maps_geocoder_cache_expired()
  from public, anon, authenticated;
grant execute on function public.prune_maps_geocoder_cache_expired() to service_role;
