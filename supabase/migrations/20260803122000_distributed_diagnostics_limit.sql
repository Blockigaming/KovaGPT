create table if not exists public.diagnostic_rate_limits (
  identity_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 1000),
  expires_at timestamptz not null,
  primary key (identity_hash, action, window_started_at)
);
alter table public.diagnostic_rate_limits enable row level security;
revoke all on public.diagnostic_rate_limits from anon, authenticated;

create or replace function public.consume_diagnostic_rate_limit(
  p_identity_hash text, p_action text, p_limit integer default 12, p_window_seconds integer default 60
) returns table (allowed boolean, retry_after integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window timestamptz := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  if length(p_identity_hash) <> 64 or p_limit not between 1 and 100 or p_window_seconds not between 10 and 3600 then
    raise exception 'invalid_rate_limit_contract';
  end if;
  insert into public.diagnostic_rate_limits(identity_hash, action, window_started_at, request_count, expires_at)
  values (p_identity_hash, left(p_action, 64), v_window, 1, v_window + make_interval(secs => p_window_seconds * 2))
  on conflict (identity_hash, action, window_started_at) do update
    set request_count = public.diagnostic_rate_limits.request_count + 1
  returning request_count into v_count;
  delete from public.diagnostic_rate_limits where expires_at < v_now;
  return query select v_count <= p_limit, greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;
revoke all on function public.consume_diagnostic_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_diagnostic_rate_limit(text, text, integer, integer) to service_role;
