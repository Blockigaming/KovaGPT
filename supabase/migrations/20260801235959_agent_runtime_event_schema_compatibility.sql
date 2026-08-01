-- Keep Constellation run events and Helios job events as separate, additive schemas.
-- Existing rows are never renamed, copied, updated, or deleted by this compatibility migration.

create table if not exists public.agent_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_job_events_job_idx
  on public.agent_job_events (job_id, created_at);

alter table public.agent_job_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_job_events'
      and policyname = 'Owners read job events'
  ) then
    execute 'create policy "Owners read job events" on public.agent_job_events for select using (exists (select 1 from public.agent_jobs j where j.id = job_id and j.owner_id = auth.uid()))';
  end if;
end
$$;

-- Preserve historical browser rows and allow status-only operator updates while rejecting new
-- browser jobs and attempts to change an existing job into an unsupported kind.
create or replace function public.enforce_supported_agent_job_kind()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind <> 'team' then
    raise exception 'Unsupported agent job kind';
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.agent_jobs'::regclass
      and tgname = 'enforce_supported_agent_job_kind'
      and not tgisinternal
  ) then
    execute 'create trigger enforce_supported_agent_job_kind before insert or update of kind on public.agent_jobs for each row execute function public.enforce_supported_agent_job_kind()';
  end if;
end
$$;

create or replace function public.lease_agent_job(
  p_worker_id text,
  p_lease_seconds integer
)
returns setof public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_id uuid;
begin
  select id
  into selected_id
  from agent_jobs
  where kind = 'team'
    and status in ('queued', 'retrying')
    and available_at <= now()
  order by priority desc, created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    return;
  end if;

  return query
  update agent_jobs
  set status = 'leased',
      worker_id = p_worker_id,
      lease_expires_at = now() + make_interval(
        secs => least(greatest(p_lease_seconds, 15), 900)
      ),
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = selected_id
  returning *;
end
$$;

revoke all on function public.lease_agent_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.lease_agent_job(text, integer) to service_role;
