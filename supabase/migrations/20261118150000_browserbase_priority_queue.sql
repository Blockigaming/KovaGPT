-- Server-owned waiting list. Tier is supplied only by trusted entitlement code.
create table public.browserbase_queue (
  owner_id uuid primary key,
  tier text not null check (tier in ('free', 'plus', 'pro')),
  queued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed boolean not null default false
);
alter table public.browserbase_queue enable row level security;
revoke all on public.browserbase_queue from public, anon, authenticated;
grant select, insert, update, delete on public.browserbase_queue to service_role;

-- Claims count against project capacity until the session ends or the lease expires.
create function public.claim_browserbase_slot(p_capacity integer, p_lease interval)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  selected_owner uuid;
begin
  if p_capacity is null or p_capacity < 1 then return null; end if;
  if p_lease is null or p_lease <= interval '0 seconds' then
    raise exception 'Invalid browser lease';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-browserbase-admission', 0));
  if (select count(*) from public.browserbase_queue
      where claimed and expires_at > clock_timestamp()) >= p_capacity then
    return null;
  end if;
  select owner_id into selected_owner from public.browserbase_queue
    where not claimed and expires_at > clock_timestamp()
    order by case tier when 'pro' then 0 when 'plus' then 1 else 2 end,
      queued_at, owner_id
    limit 1 for update;
  update public.browserbase_queue set claimed = true, expires_at = clock_timestamp() + p_lease
    where owner_id = selected_owner;
  return selected_owner;
end;
$$;
revoke all on function public.claim_browserbase_slot(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_browserbase_slot(integer, interval) to service_role;
