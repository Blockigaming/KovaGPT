create table public.browserbase_daily_usage (
  owner_id uuid not null,
  usage_day date not null,
  reserved_ms integer not null check (reserved_ms >= 0),
  primary key (owner_id, usage_day)
);
alter table public.browserbase_daily_usage enable row level security;
revoke all on public.browserbase_daily_usage from public, anon, authenticated;
grant select, insert, update on public.browserbase_daily_usage to service_role;

alter table public.browserbase_queue
  add column quota_started_at timestamptz,
  add column quota_reserved_ms integer;

-- Reserve time in the same transaction as the slot. If a process disappears,
-- a reservation stays charged, so restarts cannot replenish the daily budget.
create function public.claim_browserbase_slot_with_quota(
  p_owner uuid, p_request uuid, p_tier text, p_capacity integer
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  started_at timestamptz;
  utc_day date;
  reset_at timestamptz;
  remaining_ms integer;
  allotment_ms integer;
  limit_ms integer := case p_tier when 'free' then 600000 when 'plus' then 3600000 end;
begin
  perform pg_advisory_xact_lock(hashtextextended('kova-browserbase-admission', 0));
  started_at := clock_timestamp();
  if exists (select 1 from public.browserbase_queue
    where owner_id = p_owner and claimed and expires_at > started_at) then
    return jsonb_build_object('status', 'waiting');
  end if;
  if limit_ms is not null then
    utc_day := (started_at at time zone 'UTC')::date;
    reset_at := (utc_day + 1)::timestamp at time zone 'UTC';
    remaining_ms := limit_ms - coalesce((select reserved_ms from public.browserbase_daily_usage
      where owner_id = p_owner and usage_day = utc_day), 0);
    allotment_ms := least(remaining_ms, 960000,
      floor(extract(epoch from (reset_at - started_at)) * 1000)::integer);
    if allotment_ms <= 0 then
      return jsonb_build_object('status', 'daily_limit');
    end if;
  end if;

  if not public.claim_browserbase_slot(p_owner, p_request, p_tier, p_capacity) then
    return jsonb_build_object('status', 'waiting');
  end if;

  if limit_ms is not null then
    insert into public.browserbase_daily_usage as usage (owner_id, usage_day, reserved_ms)
      values (p_owner, utc_day, allotment_ms)
      on conflict (owner_id, usage_day) do update
        set reserved_ms = usage.reserved_ms + excluded.reserved_ms;
    update public.browserbase_queue
      set quota_started_at = started_at, quota_reserved_ms = allotment_ms
      where owner_id = p_owner and request_id = p_request;
  end if;

  return jsonb_build_object('status', 'admitted',
    'deadline', started_at + allotment_ms * interval '1 millisecond');
end;
$$;
revoke all on function public.claim_browserbase_slot_with_quota(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_browserbase_slot_with_quota(uuid, uuid, text, integer) to service_role;

-- Removing the matching queue row makes duplicate release calls harmless.
create function public.release_browserbase_slot_with_quota(
  p_owner uuid, p_request uuid, p_opened boolean
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  started_at timestamptz;
  allotment_ms integer;
  consumed_ms integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kova-browserbase-admission', 0));
  delete from public.browserbase_queue
    where owner_id = p_owner and request_id = p_request
    returning quota_started_at, quota_reserved_ms into started_at, allotment_ms;
  if not found or allotment_ms is null then return; end if;

  consumed_ms := case when p_opened is false then 0 else
    least(allotment_ms, greatest(0,
      ceil(extract(epoch from (clock_timestamp() - started_at)) * 1000)))::integer end;
  update public.browserbase_daily_usage
    set reserved_ms = reserved_ms - allotment_ms + consumed_ms
    where owner_id = p_owner and usage_day = (started_at at time zone 'UTC')::date;
end;
$$;
revoke all on function public.release_browserbase_slot_with_quota(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.release_browserbase_slot_with_quota(uuid, uuid, boolean) to service_role;
