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

-- Preserve historical rows and allow status-only operator updates while rejecting every new job
-- until an end-to-end runtime contract is deployed.
create or replace function public.enforce_supported_agent_job_kind()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Agent runtime unavailable';
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

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_jobs'
      and policyname = 'Owners create agent jobs'
  ) then
    execute 'alter policy "Owners create agent jobs" on public.agent_jobs with check (false)';
  else
    execute 'create policy "Owners create agent jobs" on public.agent_jobs for insert with check (false)';
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
begin
  return;
end
$$;

create or replace function public.control_agent_job(p_job_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if p_action <> 'cancel' then
    raise exception 'Agent runtime unavailable';
  end if;

  select status
  into current_status
  from agent_jobs
  where id = p_job_id and owner_id = auth.uid()
  for update;

  if current_status is null then
    raise exception 'Run not found';
  end if;

  if current_status in ('completed', 'failed', 'cancelled') then
    raise exception 'Invalid state transition';
  end if;

  update agent_jobs
  set status = 'cancelled',
      worker_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('id', p_job_id, 'status', 'cancelled');
end
$$;

create or replace function public.decide_agent_approval(
  p_approval_id uuid,
  p_decision text,
  p_edited_request jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision <> 'denied' then
    raise exception 'Agent runtime unavailable';
  end if;

  update agent_approvals
  set status = 'denied',
      decided_at = now()
  where id = p_approval_id
    and owner_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Approval not pending';
  end if;
end
$$;

create or replace function public.recover_expired_agent_leases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update agent_jobs
  set status = 'cancelled',
      error = 'Agent runtime unavailable',
      worker_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where status in ('leased', 'running', 'cancelling')
    and lease_expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end
$$;

create or replace function public.complete_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Agent runtime unavailable';
end
$$;

create or replace function public.heartbeat_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  update agent_jobs
  set status = 'cancelled',
      error = 'Agent runtime unavailable',
      worker_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and status in ('leased', 'running', 'cancelling')
  returning status into current_status;

  if current_status is null then
    select status into current_status from agent_jobs where id = p_job_id;
  end if;
  return current_status;
end
$$;

create or replace function public.settle_interrupted_agent_job(
  p_job_id uuid,
  p_worker_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  update agent_jobs
  set status = 'cancelled',
      error = 'Agent runtime unavailable',
      worker_id = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and status in ('leased', 'running', 'cancelling')
  returning status into current_status;

  if current_status is null then
    select status into current_status from agent_jobs where id = p_job_id;
  end if;
  return current_status;
end
$$;

create or replace function public.fail_agent_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.settle_interrupted_agent_job(p_job_id, p_worker_id);
end
$$;

create or replace function public.release_agent_lease(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.settle_interrupted_agent_job(p_job_id, p_worker_id);
end
$$;

revoke all on function public.lease_agent_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.recover_expired_agent_leases()
  from public, anon, authenticated;
revoke all on function public.complete_agent_job(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.heartbeat_agent_job(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.settle_interrupted_agent_job(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_agent_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_agent_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.lease_agent_job(text, integer) to service_role;
grant execute on function public.recover_expired_agent_leases() to service_role;
grant execute on function public.complete_agent_job(uuid, text, jsonb) to service_role;
grant execute on function public.heartbeat_agent_job(uuid, text, integer) to service_role;
grant execute on function public.settle_interrupted_agent_job(uuid, text) to service_role;
grant execute on function public.fail_agent_job(uuid, text, text) to service_role;
grant execute on function public.release_agent_lease(uuid, text) to service_role;
revoke all on function public.control_agent_job(uuid, text)
  from public, anon;
revoke all on function public.decide_agent_approval(uuid, text, jsonb)
  from public, anon;
grant execute on function public.control_agent_job(uuid, text) to authenticated;
grant execute on function public.decide_agent_approval(uuid, text, jsonb) to authenticated;
