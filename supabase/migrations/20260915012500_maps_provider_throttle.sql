-- Nominatim permits at most one request per second for the whole application.
-- Keep one rolling admission boundary so parallel server instances cannot each
-- consume an independent allowance.
create table if not exists public.maps_provider_throttle (
  provider text primary key,
  next_request_at timestamptz not null
);

alter table public.maps_provider_throttle enable row level security;
revoke all on table public.maps_provider_throttle from public, anon, authenticated;

create or replace function public.admit_maps_provider_request(
  p_provider text
) returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
begin
  if p_provider <> 'nominatim' then
    raise exception 'maps_provider_invalid' using errcode = '22023';
  end if;

  insert into public.maps_provider_throttle(provider, next_request_at)
  values (p_provider, v_now + interval '1 second')
  on conflict (provider) do update
    set next_request_at = excluded.next_request_at
    where public.maps_provider_throttle.next_request_at <= v_now
  returning next_request_at into v_next;

  if found then
    return query select true, 1;
    return;
  end if;

  select throttle.next_request_at
    into v_next
  from public.maps_provider_throttle as throttle
  where throttle.provider = p_provider;

  return query
  select false, greatest(1, ceil(extract(epoch from (v_next - v_now)))::integer);
end;
$$;

revoke all on function public.admit_maps_provider_request(text)
  from public, anon, authenticated;
grant execute on function public.admit_maps_provider_request(text) to service_role;
