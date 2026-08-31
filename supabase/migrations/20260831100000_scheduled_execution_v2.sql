-- Scheduled Execution v2: durable occurrence/attempt protocol.
--
-- This migration is intentionally additive. The product remains fail-closed until
-- the v2 worker, staging canary, scheduler heartbeat and production gates are
-- proven. Do not treat this schema as deployed scheduler readiness.

alter table public.scheduled_tasks
  add column if not exists state_version bigint not null default 0,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists time_zone text not null default 'UTC',
  add column if not exists schedule_rule jsonb,
  add column if not exists execution_blocked_reason text,
  add column if not exists retry_occurrence_id uuid;

create unique index if not exists scheduled_tasks_id_user_uidx
  on public.scheduled_tasks (id, user_id);

create table if not exists public.scheduled_task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  scheduled_local text,
  time_zone text not null default 'UTC',
  utc_offset_minutes integer,
  task_state_version bigint not null,
  title_snapshot text not null,
  prompt_snapshot text not null,
  repeat_snapshot text not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'running',
      'retry_wait',
      'succeeded',
      'failed',
      'canceled',
      'missed',
      'skipped_entitlement'
    )),
  result_summary text,
  failure_type text
    check (failure_type is null or failure_type in (
      'temporary',
      'permanent',
      'authorization',
      'timeout',
      'canceled',
      'entitlement'
    )),
  safe_error text,
  retry_after timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_task_occurrences_task_owner_fkey
    foreign key (task_id, user_id)
    references public.scheduled_tasks (id, user_id)
    on delete cascade,
  unique (task_id, scheduled_for),
  unique (id, task_id, user_id)
);

create table if not exists public.scheduled_task_attempts (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null,
  task_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 4),
  status text not null default 'running'
    check (status in (
      'running',
      'succeeded',
      'retryable_failure',
      'terminal_failure',
      'canceled',
      'expired'
    )),
  worker_id text not null,
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  provider_request_id text,
  provider_receipt text,
  result_summary text,
  failure_type text
    check (failure_type is null or failure_type in (
      'temporary',
      'permanent',
      'authorization',
      'timeout',
      'canceled',
      'lease_expired'
    )),
  safe_error text,
  retry_after timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scheduled_task_attempts_occurrence_owner_fkey
    foreign key (occurrence_id, task_id, user_id)
    references public.scheduled_task_occurrences (id, task_id, user_id)
    on delete cascade,
  unique (occurrence_id, attempt_number),
  unique (id, occurrence_id, task_id, user_id),
  unique (lease_token)
);

create table if not exists public.scheduled_task_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.scheduled_task_occurrences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email')),
  event_type text not null check (event_type in ('completed', 'failed', 'canceled', 'missed')),
  safe_preview text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'disabled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, channel, event_type)
);

create table if not exists public.scheduled_worker_heartbeats (
  environment text primary key,
  worker_revision text not null,
  source_sha text not null,
  last_started_at timestamptz not null,
  last_completed_at timestamptz,
  last_success_at timestamptz,
  last_status text not null check (last_status in ('running', 'healthy', 'failed')),
  safe_error text,
  updated_at timestamptz not null default now()
);

alter table public.scheduled_task_occurrences enable row level security;
alter table public.scheduled_task_attempts enable row level security;
alter table public.scheduled_task_delivery_outbox enable row level security;
alter table public.scheduled_worker_heartbeats enable row level security;

revoke all on public.scheduled_task_occurrences from public, anon, authenticated;
revoke all on public.scheduled_task_attempts from public, anon, authenticated;
revoke all on public.scheduled_task_delivery_outbox from public, anon, authenticated;
revoke all on public.scheduled_worker_heartbeats from public, anon, authenticated;

grant select on public.scheduled_task_occurrences to authenticated;
grant select on public.scheduled_task_attempts to authenticated;
grant select on public.scheduled_task_delivery_outbox to authenticated;
grant all on public.scheduled_task_occurrences to service_role;
grant all on public.scheduled_task_attempts to service_role;
grant all on public.scheduled_task_delivery_outbox to service_role;
grant all on public.scheduled_worker_heartbeats to service_role;

drop policy if exists "scheduled occurrences owner read" on public.scheduled_task_occurrences;
create policy "scheduled occurrences owner read"
  on public.scheduled_task_occurrences
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "scheduled attempts owner read" on public.scheduled_task_attempts;
create policy "scheduled attempts owner read"
  on public.scheduled_task_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "scheduled outbox owner read" on public.scheduled_task_delivery_outbox;
create policy "scheduled outbox owner read"
  on public.scheduled_task_delivery_outbox
  for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists scheduled_task_occurrences_owner_time_idx
  on public.scheduled_task_occurrences (user_id, scheduled_for desc);

create index if not exists scheduled_task_occurrences_retry_idx
  on public.scheduled_task_occurrences (retry_after)
  where status = 'retry_wait';

create index if not exists scheduled_task_attempts_live_lease_idx
  on public.scheduled_task_attempts (lease_expires_at)
  where status = 'running';

create index if not exists scheduled_task_attempts_owner_time_idx
  on public.scheduled_task_attempts (user_id, created_at desc);

create index if not exists scheduled_task_delivery_outbox_ready_idx
  on public.scheduled_task_delivery_outbox (available_at, created_at)
  where status in ('pending', 'failed');

-- One canonical database-side paid entitlement classifier for scheduled-task
-- creation and claim time. It mirrors the currently supported Plus/Pro product
-- identifiers while requiring a live subscription period.
create or replace function public.scheduled_task_plan_tier_v2(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.environment = 'live'
        and s.status in ('active', 'trialing', 'canceled')
        and (s.current_period_end is null or s.current_period_end > now())
        and lower(s.price_id) like '%pro%'
    ) then 'pro'
    when exists (
      select 1
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.environment = 'live'
        and s.status in ('active', 'trialing', 'canceled')
        and (s.current_period_end is null or s.current_period_end > now())
        and lower(s.price_id) like '%plus%'
    ) then 'plus'
    else 'free'
  end;
$$;

revoke all on function public.scheduled_task_plan_tier_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.scheduled_task_plan_tier_v2(uuid)
  to service_role;

create or replace function public.scheduled_task_max_active_v2(p_tier text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_tier
    when 'pro' then 20
    when 'plus' then 5
    else 0
  end;
$$;

revoke all on function public.scheduled_task_max_active_v2(text)
  from public, anon;
grant execute on function public.scheduled_task_max_active_v2(text)
  to authenticated, service_role;

-- Owner mutation RPCs replace broad client writes before v2 is enabled.
create or replace function public.owner_create_scheduled_task_v2(
  p_title text,
  p_prompt text,
  p_run_at timestamptz,
  p_repeat text,
  p_time_zone text default 'UTC',
  p_schedule_rule jsonb default null
)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_limit integer;
  v_count integer;
  v_row public.scheduled_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;
  if p_repeat not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'scheduled_task_repeat_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null or length(p_title) > 200 then
    raise exception 'scheduled_task_title_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_prompt), '') is null or length(p_prompt) > 4000 then
    raise exception 'scheduled_task_prompt_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_time_zone), '') is null or length(p_time_zone) > 100 then
    raise exception 'scheduled_task_time_zone_invalid' using errcode = '22023';
  end if;

  v_tier := public.scheduled_task_plan_tier_v2(v_user_id);
  v_limit := public.scheduled_task_max_active_v2(v_tier);
  if v_limit = 0 then
    raise exception 'scheduled_task_paid_plan_required' using errcode = '42501';
  end if;

  select count(*)
  into v_count
  from public.scheduled_tasks st
  where st.user_id = v_user_id
    and st.deleted_at is null
    and st.status in ('scheduled', 'running', 'paused');

  if v_count >= v_limit then
    raise exception 'scheduled_task_plan_limit_reached' using errcode = '54000';
  end if;

  insert into public.scheduled_tasks (
    user_id,
    title,
    prompt,
    run_at,
    next_run_at,
    repeat,
    status,
    time_zone,
    schedule_rule,
    state_version
  ) values (
    v_user_id,
    btrim(p_title),
    btrim(p_prompt),
    p_run_at,
    p_run_at,
    p_repeat,
    'scheduled',
    p_time_zone,
    p_schedule_rule,
    1
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.owner_update_scheduled_task_v2(
  p_task_id uuid,
  p_title text default null,
  p_prompt text default null,
  p_run_at timestamptz default null,
  p_repeat text default null,
  p_time_zone text default null,
  p_schedule_rule jsonb default null,
  p_replace_schedule_rule boolean default false
)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.scheduled_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;

  select * into v_row
  from public.scheduled_tasks
  where id = p_task_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;

  if p_title is not null and (nullif(btrim(p_title), '') is null or length(p_title) > 200) then
    raise exception 'scheduled_task_title_invalid' using errcode = '22023';
  end if;
  if p_prompt is not null and (nullif(btrim(p_prompt), '') is null or length(p_prompt) > 4000) then
    raise exception 'scheduled_task_prompt_invalid' using errcode = '22023';
  end if;
  if p_repeat is not null and p_repeat not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'scheduled_task_repeat_invalid' using errcode = '22023';
  end if;
  if p_time_zone is not null and (nullif(btrim(p_time_zone), '') is null or length(p_time_zone) > 100) then
    raise exception 'scheduled_task_time_zone_invalid' using errcode = '22023';
  end if;

  update public.scheduled_tasks
  set
    title = coalesce(btrim(p_title), title),
    prompt = coalesce(btrim(p_prompt), prompt),
    run_at = coalesce(p_run_at, run_at),
    next_run_at = case when p_run_at is not null then p_run_at else next_run_at end,
    repeat = coalesce(p_repeat, repeat),
    time_zone = coalesce(p_time_zone, time_zone),
    schedule_rule = case when p_replace_schedule_rule then p_schedule_rule else schedule_rule end,
    state_version = state_version + 1,
    updated_at = now()
  where id = p_task_id and user_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.owner_set_scheduled_task_state_v2(
  p_task_id uuid,
  p_action text
)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.scheduled_tasks%rowtype;
  v_tier text;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;
  if p_action not in ('pause', 'resume', 'cancel', 'delete') then
    raise exception 'scheduled_task_action_invalid' using errcode = '22023';
  end if;

  select * into v_row
  from public.scheduled_tasks
  where id = p_task_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'resume' then
    v_tier := public.scheduled_task_plan_tier_v2(v_user_id);
    if v_tier = 'free' then
      raise exception 'scheduled_task_paid_plan_required' using errcode = '42501';
    end if;
  end if;

  update public.scheduled_tasks
  set
    status = case
      when p_action = 'pause' and status <> 'running' then 'paused'
      when p_action = 'resume' then 'scheduled'
      when p_action = 'delete' and status <> 'running' then 'paused'
      else status
    end,
    cancel_requested_at = case
      when p_action in ('cancel', 'delete') and status = 'running' then now()
      when p_action = 'resume' then null
      else cancel_requested_at
    end,
    deleted_at = case when p_action = 'delete' then now() else deleted_at end,
    execution_blocked_reason = case
      when p_action = 'resume' then null
      when p_action = 'pause' then 'owner_paused'
      when p_action = 'cancel' then 'owner_canceled'
      when p_action = 'delete' then 'owner_deleted'
      else execution_blocked_reason
    end,
    state_version = state_version + 1,
    updated_at = now()
  where id = p_task_id and user_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.owner_create_scheduled_task_v2(text, text, timestamptz, text, text, jsonb)
  from public, anon;
revoke all on function public.owner_update_scheduled_task_v2(uuid, text, text, timestamptz, text, text, jsonb, boolean)
  from public, anon;
revoke all on function public.owner_set_scheduled_task_state_v2(uuid, text)
  from public, anon;

grant execute on function public.owner_create_scheduled_task_v2(text, text, timestamptz, text, text, jsonb)
  to authenticated;
grant execute on function public.owner_update_scheduled_task_v2(uuid, text, text, timestamptz, text, text, jsonb, boolean)
  to authenticated;
grant execute on function public.owner_set_scheduled_task_state_v2(uuid, text)
  to authenticated;

-- Service-role helper: pause due rows that no longer have paid entitlement.
create or replace function public.pause_ineligible_scheduled_tasks_v2(p_limit integer default 100)
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

  with candidates as (
    select st.id
    from public.scheduled_tasks st
    where st.status = 'scheduled'
      and st.deleted_at is null
      and coalesce(st.retry_after, st.next_run_at, st.run_at) <= now()
      and public.scheduled_task_plan_tier_v2(st.user_id) = 'free'
    order by coalesce(st.retry_after, st.next_run_at, st.run_at), st.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  update public.scheduled_tasks st
  set
    status = 'paused',
    execution_blocked_reason = 'entitlement',
    worker_id = null,
    lease_expires_at = null,
    updated_at = now()
  from candidates c
  where st.id = c.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Atomically materialize/reuse an occurrence, create exactly one next attempt,
-- and return an immutable execution snapshot plus opaque fencing token.
create or replace function public.claim_due_scheduled_task_occurrence_v2(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  task_id uuid,
  user_id uuid,
  occurrence_id uuid,
  attempt_id uuid,
  attempt_number integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  task_state_version bigint,
  scheduled_for timestamptz,
  title text,
  prompt text,
  repeat text,
  time_zone text,
  schedule_rule jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_scheduled_for timestamptz;
  v_attempt_number integer;
  v_lease_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id_required' using errcode = '22023';
  end if;

  v_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 120), 900));

  select st.*
  into v_task
  from public.scheduled_tasks st
  where st.status = 'scheduled'
    and st.deleted_at is null
    and st.cancel_requested_at is null
    and coalesce(st.retry_after, st.next_run_at, st.run_at) <= now()
    and public.scheduled_task_plan_tier_v2(st.user_id) in ('plus', 'pro')
    and not exists (
      select 1
      from public.scheduled_task_occurrences active_occ
      where active_occ.user_id = st.user_id
        and active_occ.status = 'running'
    )
  order by coalesce(st.retry_after, st.next_run_at, st.run_at), st.id
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  if v_task.retry_occurrence_id is not null then
    select * into v_occ
    from public.scheduled_task_occurrences
    where id = v_task.retry_occurrence_id
      and task_id = v_task.id
      and user_id = v_task.user_id
      and status = 'retry_wait'
    for update;

    if not found then
      raise exception 'scheduled_retry_occurrence_missing' using errcode = '55000';
    end if;
    v_scheduled_for := v_occ.scheduled_for;
  else
    v_scheduled_for := coalesce(v_task.next_run_at, v_task.run_at);

    insert into public.scheduled_task_occurrences (
      task_id,
      user_id,
      scheduled_for,
      time_zone,
      task_state_version,
      title_snapshot,
      prompt_snapshot,
      repeat_snapshot,
      status
    ) values (
      v_task.id,
      v_task.user_id,
      v_scheduled_for,
      v_task.time_zone,
      v_task.state_version,
      v_task.title,
      v_task.prompt,
      v_task.repeat,
      'pending'
    )
    on conflict (task_id, scheduled_for) do update
      set updated_at = now()
    returning * into v_occ;

    if v_occ.status not in ('pending', 'retry_wait') then
      raise exception 'scheduled_occurrence_not_claimable' using errcode = '55000';
    end if;
  end if;

  select coalesce(max(a.attempt_number), 0) + 1
  into v_attempt_number
  from public.scheduled_task_attempts a
  where a.occurrence_id = v_occ.id;

  if v_attempt_number > 4 then
    raise exception 'scheduled_attempt_limit_reached' using errcode = '55000';
  end if;

  insert into public.scheduled_task_attempts (
    occurrence_id,
    task_id,
    user_id,
    attempt_number,
    worker_id,
    lease_expires_at
  ) values (
    v_occ.id,
    v_task.id,
    v_task.user_id,
    v_attempt_number,
    p_worker_id,
    now() + make_interval(secs => v_lease_seconds)
  ) returning * into v_attempt;

  update public.scheduled_task_occurrences
  set status = 'running', retry_after = null, updated_at = now()
  where id = v_occ.id;

  update public.scheduled_tasks
  set
    status = 'running',
    worker_id = p_worker_id,
    lease_expires_at = v_attempt.lease_expires_at,
    execution_attempts = v_attempt_number,
    retry_after = null,
    retry_occurrence_id = null,
    execution_blocked_reason = null,
    updated_at = now()
  where id = v_task.id;

  return query select
    v_task.id,
    v_task.user_id,
    v_occ.id,
    v_attempt.id,
    v_attempt.attempt_number,
    v_attempt.lease_token,
    v_attempt.lease_expires_at,
    v_occ.task_state_version,
    v_occ.scheduled_for,
    v_occ.title_snapshot,
    v_occ.prompt_snapshot,
    v_occ.repeat_snapshot,
    v_occ.time_zone,
    v_task.schedule_rule;
end;
$$;

-- Heartbeats are fenced by attempt + occurrence + lease token. They also return
-- whether owner cancellation/deletion was requested so the worker can abort.
create or replace function public.heartbeat_scheduled_task_attempt_v2(
  p_task_id uuid,
  p_occurrence_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_extend_seconds integer default 120
)
returns table (
  lease_expires_at timestamptz,
  cancel_requested boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_expiry timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.scheduled_task_attempts
  where id = p_attempt_id
    and occurrence_id = p_occurrence_id
    and task_id = p_task_id
    and lease_token = p_lease_token
    and status = 'running'
  for update;
  if not found or v_attempt.lease_expires_at <= now() then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;

  v_expiry := now() + make_interval(
    secs => greatest(30, least(coalesce(p_extend_seconds, 120), 900))
  );

  update public.scheduled_task_attempts
  set lease_expires_at = v_expiry
  where id = p_attempt_id;
  update public.scheduled_tasks
  set lease_expires_at = v_expiry, updated_at = now()
  where id = p_task_id;

  return query select
    v_expiry,
    (v_task.cancel_requested_at is not null or v_task.deleted_at is not null);
end;
$$;

create or replace function public.recover_expired_scheduled_task_attempts_v2(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
  v_retry_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  for v_row in
    select a.id as attempt_id, a.task_id, a.occurrence_id, a.attempt_number
    from public.scheduled_task_attempts a
    where a.status = 'running' and a.lease_expires_at <= now()
    order by a.lease_expires_at, a.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    v_retry_at := case v_row.attempt_number
      when 1 then now() + interval '1 minute'
      when 2 then now() + interval '5 minutes'
      when 3 then now() + interval '15 minutes'
      else null
    end;

    update public.scheduled_task_attempts
    set
      status = 'expired',
      failure_type = 'lease_expired',
      safe_error = 'The worker lease expired before settlement.',
      retry_after = v_retry_at,
      completed_at = now()
    where id = v_row.attempt_id and status = 'running';

    update public.scheduled_task_occurrences
    set
      status = case when v_retry_at is null then 'failed' else 'retry_wait' end,
      failure_type = 'timeout',
      safe_error = 'The worker lease expired before settlement.',
      retry_after = v_retry_at,
      completed_at = case when v_retry_at is null then now() else null end,
      updated_at = now()
    where id = v_row.occurrence_id;

    update public.scheduled_tasks
    set
      status = case when v_retry_at is null then 'failed' else 'scheduled' end,
      worker_id = null,
      lease_expires_at = null,
      retry_after = v_retry_at,
      retry_occurrence_id = case when v_retry_at is null then null else v_row.occurrence_id end,
      last_failure_type = 'timeout',
      last_error = 'The worker lease expired before settlement.',
      updated_at = now()
    where id = v_row.task_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Shared fencing loader is intentionally expressed inline in settlement RPCs so
-- stale workers cannot settle a newer attempt by worker_id alone.
create or replace function public.settle_scheduled_task_success_v2(
  p_task_id uuid,
  p_occurrence_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_provider_request_id text,
  p_provider_receipt text,
  p_result text
)
returns table (
  next_run_at timestamptz,
  outbox_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_next timestamptz;
  v_preview text;
  v_notify boolean := true;
  v_outbox boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.scheduled_task_attempts
  where id = p_attempt_id
    and occurrence_id = p_occurrence_id
    and task_id = p_task_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  if v_attempt.status = 'succeeded' then
    select st.next_run_at into v_next from public.scheduled_tasks st where st.id = p_task_id;
    return query select v_next, exists (
      select 1 from public.scheduled_task_delivery_outbox o
      where o.occurrence_id = p_occurrence_id and o.event_type = 'completed'
    );
    return;
  end if;
  if v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_occ
  from public.scheduled_task_occurrences
  where id = p_occurrence_id and task_id = p_task_id
  for update;
  if not found or v_occ.status <> 'running' then
    raise exception 'scheduled_occurrence_not_running' using errcode = '55000';
  end if;

  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;
  if v_task.cancel_requested_at is not null or v_task.deleted_at is not null then
    raise exception 'scheduled_execution_cancel_requested' using errcode = '57014';
  end if;
  if v_task.state_version <> v_occ.task_state_version then
    raise exception 'scheduled_execution_state_changed' using errcode = '40001';
  end if;

  v_next := public.next_scheduled_task_occurrence(v_occ.scheduled_for, v_occ.repeat_snapshot);
  v_preview := left(
    regexp_replace(
      coalesce(nullif(btrim(p_result), ''), 'Scheduled task completed.'),
      E'[\\r\\n\\t]+', ' ', 'g'
    ),
    220
  );

  update public.scheduled_task_attempts
  set
    status = 'succeeded',
    provider_request_id = nullif(left(coalesce(p_provider_request_id, ''), 200), ''),
    provider_receipt = nullif(left(coalesce(p_provider_receipt, ''), 500), ''),
    result_summary = left(coalesce(p_result, ''), 12000),
    completed_at = now()
  where id = p_attempt_id;

  update public.scheduled_task_occurrences
  set
    status = 'succeeded',
    result_summary = left(coalesce(p_result, ''), 12000),
    failure_type = null,
    safe_error = null,
    retry_after = null,
    completed_at = now(),
    updated_at = now()
  where id = p_occurrence_id;

  update public.scheduled_tasks
  set
    status = case when v_next is null then 'completed' else 'scheduled' end,
    last_run_at = now(),
    next_run_at = v_next,
    last_result = left(coalesce(p_result, ''), 12000),
    worker_id = null,
    lease_expires_at = null,
    retry_after = null,
    retry_occurrence_id = null,
    execution_attempts = 0,
    last_failure_type = null,
    last_error = null,
    updated_at = now()
  where id = p_task_id;

  select
    coalesce(np.in_app_enabled, true)
    and coalesce((np.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences np
  where np.user_id = v_task.user_id;
  if not found then v_notify := true; end if;

  if v_notify then
    insert into public.scheduled_task_delivery_outbox (
      occurrence_id, user_id, channel, event_type, safe_preview
    ) values (
      p_occurrence_id, v_task.user_id, 'in_app', 'completed', v_preview
    ) on conflict (occurrence_id, channel, event_type) do nothing;
    v_outbox := true;
  end if;

  return query select v_next, v_outbox;
end;
$$;

create or replace function public.settle_scheduled_task_failure_v2(
  p_task_id uuid,
  p_occurrence_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_failure_type text,
  p_safe_error text,
  p_retryable boolean
)
returns table (
  retry_at timestamptz,
  terminal boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_retry_at timestamptz;
  v_error text;
  v_should_retry boolean;
  v_base_seconds integer;
  v_jitter_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if p_failure_type not in ('temporary', 'permanent', 'authorization', 'timeout') then
    raise exception 'invalid_failure_type' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.scheduled_task_attempts
  where id = p_attempt_id
    and occurrence_id = p_occurrence_id
    and task_id = p_task_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  if v_attempt.status in ('retryable_failure', 'terminal_failure') then
    return query select v_attempt.retry_after, v_attempt.status = 'terminal_failure';
    return;
  end if;
  if v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_occ
  from public.scheduled_task_occurrences
  where id = p_occurrence_id and task_id = p_task_id
  for update;
  if not found or v_occ.status <> 'running' then
    raise exception 'scheduled_occurrence_not_running' using errcode = '55000';
  end if;

  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;

  v_error := left(coalesce(nullif(btrim(p_safe_error), ''), 'Scheduled task failed.'), 500);
  v_should_retry := p_retryable
    and p_failure_type in ('temporary', 'timeout')
    and v_attempt.attempt_number < 4
    and v_task.cancel_requested_at is null
    and v_task.deleted_at is null
    and public.scheduled_task_plan_tier_v2(v_task.user_id) in ('plus', 'pro');

  if v_should_retry then
    v_base_seconds := case v_attempt.attempt_number
      when 1 then 60
      when 2 then 300
      else 900
    end;
    v_jitter_seconds := floor(
      v_base_seconds *
      (abs(hashtextextended(p_occurrence_id::text, v_attempt.attempt_number::bigint)) % 21) / 100.0
    )::integer;
    v_retry_at := now() + make_interval(secs => v_base_seconds + v_jitter_seconds);
  else
    v_retry_at := null;
  end if;

  update public.scheduled_task_attempts
  set
    status = case when v_retry_at is null then 'terminal_failure' else 'retryable_failure' end,
    failure_type = p_failure_type,
    safe_error = v_error,
    retry_after = v_retry_at,
    completed_at = now()
  where id = p_attempt_id;

  update public.scheduled_task_occurrences
  set
    status = case when v_retry_at is null then 'failed' else 'retry_wait' end,
    failure_type = p_failure_type,
    safe_error = v_error,
    retry_after = v_retry_at,
    completed_at = case when v_retry_at is null then now() else null end,
    updated_at = now()
  where id = p_occurrence_id;

  update public.scheduled_tasks
  set
    status = case when v_retry_at is null then 'failed' else 'scheduled' end,
    last_run_at = now(),
    worker_id = null,
    lease_expires_at = null,
    retry_after = v_retry_at,
    retry_occurrence_id = case when v_retry_at is null then null else p_occurrence_id end,
    last_failure_type = p_failure_type,
    last_error = v_error,
    updated_at = now()
  where id = p_task_id;

  if v_retry_at is null then
    insert into public.scheduled_task_delivery_outbox (
      occurrence_id, user_id, channel, event_type, safe_preview
    ) values (
      p_occurrence_id,
      v_task.user_id,
      'in_app',
      'failed',
      left(regexp_replace(v_error, E'[\\r\\n\\t]+', ' ', 'g'), 220)
    ) on conflict (occurrence_id, channel, event_type) do nothing;
  end if;

  return query select v_retry_at, v_retry_at is null;
end;
$$;

create or replace function public.settle_scheduled_task_canceled_v2(
  p_task_id uuid,
  p_occurrence_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.scheduled_task_attempts
  where id = p_attempt_id
    and occurrence_id = p_occurrence_id
    and task_id = p_task_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  if v_attempt.status = 'canceled' then return true; end if;
  if v_attempt.status <> 'running' then
    raise exception 'scheduled_attempt_not_running' using errcode = '55000';
  end if;

  select * into v_task from public.scheduled_tasks where id = p_task_id for update;
  if not found then raise exception 'scheduled_task_not_found' using errcode = 'P0002'; end if;
  if v_task.cancel_requested_at is null and v_task.deleted_at is null then
    raise exception 'scheduled_cancel_not_requested' using errcode = '55000';
  end if;

  update public.scheduled_task_attempts
  set status = 'canceled', failure_type = 'canceled', completed_at = now()
  where id = p_attempt_id;

  update public.scheduled_task_occurrences
  set
    status = 'canceled',
    failure_type = 'canceled',
    safe_error = 'Canceled by owner request.',
    retry_after = null,
    completed_at = now(),
    updated_at = now()
  where id = p_occurrence_id;

  update public.scheduled_tasks
  set
    status = 'paused',
    worker_id = null,
    lease_expires_at = null,
    retry_after = null,
    retry_occurrence_id = null,
    execution_attempts = 0,
    updated_at = now()
  where id = p_task_id;

  insert into public.scheduled_task_delivery_outbox (
    occurrence_id, user_id, channel, event_type, safe_preview
  ) values (
    p_occurrence_id,
    v_task.user_id,
    'in_app',
    'canceled',
    'Scheduled task canceled.'
  ) on conflict (occurrence_id, channel, event_type) do nothing;

  return true;
end;
$$;

create or replace function public.record_scheduled_worker_heartbeat_v2(
  p_environment text,
  p_worker_revision text,
  p_source_sha text,
  p_status text,
  p_safe_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if p_status not in ('running', 'healthy', 'failed') then
    raise exception 'scheduled_worker_status_invalid' using errcode = '22023';
  end if;

  insert into public.scheduled_worker_heartbeats (
    environment,
    worker_revision,
    source_sha,
    last_started_at,
    last_completed_at,
    last_success_at,
    last_status,
    safe_error,
    updated_at
  ) values (
    left(p_environment, 50),
    left(p_worker_revision, 200),
    left(p_source_sha, 64),
    now(),
    case when p_status <> 'running' then now() else null end,
    case when p_status = 'healthy' then now() else null end,
    p_status,
    left(p_safe_error, 500),
    now()
  )
  on conflict (environment) do update set
    worker_revision = excluded.worker_revision,
    source_sha = excluded.source_sha,
    last_started_at = case
      when excluded.last_status = 'running' then now()
      else public.scheduled_worker_heartbeats.last_started_at
    end,
    last_completed_at = case
      when excluded.last_status <> 'running' then now()
      else public.scheduled_worker_heartbeats.last_completed_at
    end,
    last_success_at = case
      when excluded.last_status = 'healthy' then now()
      else public.scheduled_worker_heartbeats.last_success_at
    end,
    last_status = excluded.last_status,
    safe_error = excluded.safe_error,
    updated_at = now();
end;
$$;

revoke all on function public.pause_ineligible_scheduled_tasks_v2(integer)
  from public, anon, authenticated;
revoke all on function public.claim_due_scheduled_task_occurrence_v2(text, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_scheduled_task_attempt_v2(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.recover_expired_scheduled_task_attempts_v2(integer)
  from public, anon, authenticated;
revoke all on function public.settle_scheduled_task_success_v2(uuid, uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_scheduled_task_failure_v2(uuid, uuid, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.settle_scheduled_task_canceled_v2(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.record_scheduled_worker_heartbeat_v2(text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.pause_ineligible_scheduled_tasks_v2(integer)
  to service_role;
grant execute on function public.claim_due_scheduled_task_occurrence_v2(text, integer)
  to service_role;
grant execute on function public.heartbeat_scheduled_task_attempt_v2(uuid, uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.recover_expired_scheduled_task_attempts_v2(integer)
  to service_role;
grant execute on function public.settle_scheduled_task_success_v2(uuid, uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.settle_scheduled_task_failure_v2(uuid, uuid, uuid, uuid, text, text, boolean)
  to service_role;
grant execute on function public.settle_scheduled_task_canceled_v2(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.record_scheduled_worker_heartbeat_v2(text, text, text, text, text)
  to service_role;

-- Existing broad table mutation must not be relied on once v2 is deployed.
-- Owner RPCs above retain authenticated control while execution-owned fields stay
-- service-only. SELECT remains available under the existing owner RLS policy.
revoke insert, update, delete on public.scheduled_tasks from authenticated;
grant select on public.scheduled_tasks to authenticated;
grant all on public.scheduled_tasks to service_role;
