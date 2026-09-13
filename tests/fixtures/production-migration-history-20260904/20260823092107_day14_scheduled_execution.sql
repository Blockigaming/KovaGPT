-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 14: secure scheduled-task execution lease foundation.

alter table public.scheduled_tasks
  add column if not exists worker_id text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists retry_after timestamptz,
  add column if not exists last_failure_type text,
  add column if not exists last_error text;

create index if not exists idx_scheduled_tasks_due_execution
  on public.scheduled_tasks (next_run_at)
  where status = 'scheduled';

create index if not exists idx_scheduled_tasks_execution_lease
  on public.scheduled_tasks (lease_expires_at)
  where status = 'running';

create or replace function public.claim_due_scheduled_tasks(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_lease_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id_required' using errcode = '22023';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 10), 100));
  v_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
  return query
  with candidates as (
    select st.id
    from public.scheduled_tasks st
    where st.status = 'scheduled'
      and coalesce(st.retry_after, st.next_run_at, st.run_at) <= now()
    order by coalesce(st.retry_after, st.next_run_at, st.run_at), st.id
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.scheduled_tasks st
    set status = 'running',
        worker_id = p_worker_id,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        execution_attempts = coalesce(st.execution_attempts, 0) + 1,
        retry_after = null,
        updated_at = now()
    from candidates c
    where st.id = c.id
    returning st.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_due_scheduled_tasks(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_tasks(text, integer, integer) to service_role;

create or replace function public.recover_expired_scheduled_task_leases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  update public.scheduled_tasks
  set status = 'scheduled', worker_id = null, lease_expires_at = null, updated_at = now()
  where status = 'running' and lease_expires_at is not null and lease_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recover_expired_scheduled_task_leases() from public, anon, authenticated;
grant execute on function public.recover_expired_scheduled_task_leases() to service_role;

create or replace function public.next_scheduled_task_occurrence(
  p_previous timestamptz,
  p_repeat text
)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  v_next timestamptz;
begin
  if p_repeat = 'none' then return null; end if;
  v_next := p_previous;
  loop
    v_next := case p_repeat
      when 'daily' then v_next + interval '1 day'
      when 'weekly' then v_next + interval '1 week'
      when 'monthly' then v_next + interval '1 month'
      else null
    end;
    if v_next is null or v_next > now() then return v_next; end if;
  end loop;
end;
$$;

create or replace function public.complete_scheduled_task_execution(
  p_task_id uuid,
  p_worker_id text,
  p_scheduled_for timestamptz,
  p_result text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_next timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id and status = 'running' and worker_id = p_worker_id and lease_expires_at > now()
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  v_next := public.next_scheduled_task_occurrence(p_scheduled_for, v_task.repeat);
  update public.scheduled_tasks
  set status = case when v_next is null then 'completed' else 'scheduled' end,
      last_run_at = now(),
      next_run_at = v_next,
      last_result = left(coalesce(p_result, ''), 12000),
      worker_id = null,
      lease_expires_at = null,
      retry_after = null,
      execution_attempts = 0,
      last_failure_type = null,
      last_error = null,
      updated_at = now()
  where id = p_task_id;
  return v_next;
end;
$$;

create or replace function public.fail_scheduled_task_execution(
  p_task_id uuid,
  p_worker_id text,
  p_failure_type text,
  p_safe_error text,
  p_retryable boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_retry_at timestamptz;
  v_should_retry boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if p_failure_type not in ('temporary','permanent','authorization','timeout') then
    raise exception 'invalid_failure_type' using errcode = '22023';
  end if;
  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id and status = 'running' and worker_id = p_worker_id
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  v_should_retry := p_retryable and p_failure_type in ('temporary','timeout') and v_task.execution_attempts < 4;
  if v_should_retry then
    v_retry_at := now() + case v_task.execution_attempts
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      else interval '15 minutes'
    end;
  else
    v_retry_at := null;
  end if;
  update public.scheduled_tasks
  set status = case when v_retry_at is null then 'failed' else 'scheduled' end,
      worker_id = null,
      lease_expires_at = null,
      retry_after = v_retry_at,
      last_failure_type = p_failure_type,
      last_error = left(coalesce(nullif(trim(p_safe_error), ''), 'Scheduled task failed.'), 500),
      updated_at = now()
  where id = p_task_id;
  return v_retry_at;
end;
$$;

revoke all on function public.complete_scheduled_task_execution(uuid,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.fail_scheduled_task_execution(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.complete_scheduled_task_execution(uuid,text,timestamptz,text) to service_role;
grant execute on function public.fail_scheduled_task_execution(uuid,text,text,text,boolean) to service_role;
;
