-- Server-owned queue. The tier and request ID come from the authenticated gateway.
create table public.browserbase_queue (
  owner_id uuid primary key,
  request_id uuid not null unique,
  tier text not null check (tier in ('free', 'plus', 'pro')),
  queued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed boolean not null default false,
  preview_expires_at timestamptz,
  preview_jpeg text check (length(preview_jpeg) <= 350000)
);
alter table public.browserbase_queue enable row level security;
revoke all on public.browserbase_queue from public, anon, authenticated;
grant select, insert, update, delete on public.browserbase_queue to service_role;

-- Each waiter can claim only its own request. An expired or canceled waiter
-- cannot reserve a provider slot on behalf of another process.
create function public.claim_browserbase_slot(
  p_owner uuid, p_request uuid, p_tier text, p_capacity integer
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  selected_request uuid;
  current_time_at timestamptz;
begin
  if p_capacity is null or p_capacity < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-browserbase-admission', 0));
  current_time_at := clock_timestamp();
  delete from public.browserbase_queue where expires_at <= current_time_at;
  insert into public.browserbase_queue (owner_id, request_id, tier, expires_at)
    values (p_owner, p_request, p_tier, current_time_at + interval '45 seconds')
    on conflict (owner_id) do nothing;
  if (select count(*) from public.browserbase_queue where claimed) >= p_capacity then
    return false;
  end if;
  select request_id into selected_request from public.browserbase_queue
    where not claimed
    order by case tier when 'pro' then 0 when 'plus' then 1 else 2 end, queued_at, owner_id
    limit 1 for update;
  if selected_request is distinct from p_request then return false; end if;
  update public.browserbase_queue set claimed = true, expires_at = current_time_at + interval '17 minutes'
    where owner_id = p_owner and request_id = p_request;
  return found;
end;
$$;
revoke all on function public.claim_browserbase_slot(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_browserbase_slot(uuid, uuid, text, integer) to service_role;
