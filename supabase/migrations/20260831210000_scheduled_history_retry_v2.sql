-- Scheduled Execution v2 owner history/manual-retry completion.
--
-- Forward-only and source-only. This does not enable the scheduler or apply the
-- schema to any database.

alter table public.scheduled_task_occurrences
  add column if not exists recurrence_anchor timestamptz,
  add column if not exists manual_retry_of uuid;

update public.scheduled_task_occurrences
set recurrence_anchor = scheduled_for
where recurrence_anchor is null;

create or replace function public.set_scheduled_occurrence_anchor_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.recurrence_anchor is null then
    new.recurrence_anchor := new.scheduled_for;
  end if;
  return new;
end;
$$;

drop trigger if exists scheduled_occurrence_anchor_v2
  on public.scheduled_task_occurrences;
create trigger scheduled_occurrence_anchor_v2
before insert or update of scheduled_for, recurrence_anchor
on public.scheduled_task_occurrences
for each row
execute function public.set_scheduled_occurrence_anchor_v2();

alter table public.scheduled_task_occurrences
  alter column recurrence_anchor set not null;

alter table public.scheduled_task_occurrences
  drop constraint if exists scheduled_task_occurrences_manual_retry_of_fkey;
alter table public.scheduled_task_occurrences
  add constraint scheduled_task_occurrences_manual_retry_of_fkey
  foreign key (manual_retry_of)
  references public.scheduled_task_occurrences(id)
  on delete set null;

create index if not exists scheduled_task_occurrences_manual_retry_idx
  on public.scheduled_task_occurrences (manual_retry_of)
  where manual_retry_of is not null;

-- A manual retry gets a new occurrence identity so all prior attempts remain
-- immutable. recurrence_anchor preserves the original recurring cadence rather
-- than moving future runs to the moment the user pressed Retry.
create or replace function public.owner_retry_scheduled_task_v2(p_task_id uuid)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.scheduled_tasks%rowtype;
  v_failed public.scheduled_task_occurrences%rowtype;
  v_retry public.scheduled_task_occurrences%rowtype;
  v_retry_at timestamptz := now();
  v_local timestamp without time zone;
  v_offset integer;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;

  select task.* into v_task
  from public.scheduled_tasks task
  where task.id = p_task_id
    and task.user_id = v_user_id
    and task.deleted_at is null
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status <> 'failed' then
    raise exception 'scheduled_task_retry_not_failed' using errcode = '55000';
  end if;
  if public.scheduled_task_plan_tier_v2(v_user_id) not in ('plus', 'pro') then
    raise exception 'scheduled_task_paid_plan_required' using errcode = '42501';
  end if;

  select occurrence.* into v_failed
  from public.scheduled_task_occurrences occurrence
  where occurrence.task_id = v_task.id
    and occurrence.user_id = v_user_id
    and occurrence.status = 'failed'
  order by coalesce(occurrence.completed_at, occurrence.updated_at) desc, occurrence.id desc
  limit 1
  for update;
  if not found then
    raise exception 'scheduled_task_failed_occurrence_missing' using errcode = '55000';
  end if;

  v_local := v_retry_at at time zone v_task.time_zone;
  v_offset := round(
    extract(epoch from (v_local - (v_retry_at at time zone 'UTC'))) / 60
  )::integer;

  insert into public.scheduled_task_occurrences (
    task_id,
    user_id,
    scheduled_for,
    recurrence_anchor,
    manual_retry_of,
    scheduled_local,
    time_zone,
    utc_offset_minutes,
    task_state_version,
    title_snapshot,
    prompt_snapshot,
    repeat_snapshot,
    schedule_rule_snapshot,
    status,
    retry_after,
    missed_count,
    missed_policy,
    schedule_resolution
  ) values (
    v_task.id,
    v_user_id,
    v_retry_at,
    v_failed.recurrence_anchor,
    v_failed.id,
    to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    v_task.time_zone,
    v_offset,
    v_task.state_version,
    v_task.title,
    v_task.prompt,
    v_task.repeat,
    coalesce(v_task.schedule_rule, '{}'::jsonb),
    'retry_wait',
    v_retry_at,
    0,
    coalesce(v_task.schedule_rule ->> 'missed_run_policy', 'coalesce_latest'),
    'manual_retry'
  ) returning * into v_retry;

  update public.scheduled_tasks
  set
    status = 'scheduled',
    worker_id = null,
    lease_expires_at = null,
    retry_after = v_retry_at,
    retry_occurrence_id = v_retry.id,
    execution_attempts = 0,
    execution_blocked_reason = null,
    cancel_requested_at = null,
    updated_at = now()
  where id = v_task.id and user_id = v_user_id
  returning * into v_task;

  return v_task;
end;
$$;

revoke all on function public.owner_retry_scheduled_task_v2(uuid)
  from public, anon;
grant execute on function public.owner_retry_scheduled_task_v2(uuid)
  to authenticated;

-- Recurrence after a successful manual retry advances from the original
-- occurrence anchor, while one-time tasks still terminate normally.
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
    select task.next_run_at into v_next
    from public.scheduled_tasks task
    where task.id = p_task_id;
    return query select v_next, exists (
      select 1
      from public.scheduled_task_delivery_outbox outbox
      where outbox.occurrence_id = p_occurrence_id
        and outbox.event_type = 'completed'
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

  select next_occurrence.next_run_at into v_next
  from public.scheduled_next_occurrence_v2(
    v_occ.recurrence_anchor,
    v_occ.repeat_snapshot,
    v_occ.time_zone,
    v_occ.schedule_rule_snapshot
  ) next_occurrence;

  v_preview := left(
    regexp_replace(
      coalesce(nullif(btrim(p_result), ''), 'Scheduled task completed.'),
      E'[\\r\\n\\t]+',
      ' ',
      'g'
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
    coalesce(preferences.in_app_enabled, true)
    and coalesce((preferences.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences preferences
  where preferences.user_id = v_task.user_id;
  if not found then
    v_notify := true;
  end if;

  if v_notify then
    insert into public.scheduled_task_delivery_outbox (
      occurrence_id,
      user_id,
      channel,
      event_type,
      safe_preview
    ) values (
      p_occurrence_id,
      v_task.user_id,
      'in_app',
      'completed',
      v_preview
    ) on conflict (occurrence_id, channel, event_type) do nothing;
    v_outbox := true;
  end if;

  return query select v_next, v_outbox;
end;
$$;
