-- Scheduled Execution v2 active-owner-mutation fencing.
--
-- Active edits, pauses and deletes request cancellation of the immutable running
-- occurrence. Settlement then distinguishes an edited task that should requeue
-- from an owner-paused/deleted task that must remain stopped.

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
  where id = p_task_id
    and user_id = v_user_id
    and deleted_at is null
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'resume' then
    if v_row.status <> 'paused' then
      raise exception 'scheduled_task_resume_requires_paused' using errcode = '55000';
    end if;
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
      when p_action = 'cancel' and status <> 'running' then 'paused'
      when p_action = 'delete' and status <> 'running' then 'paused'
      else status
    end,
    cancel_requested_at = case
      when p_action in ('pause', 'cancel', 'delete') and status = 'running' then now()
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

revoke all on function public.owner_set_scheduled_task_state_v2(uuid, text)
  from public, anon;
grant execute on function public.owner_set_scheduled_task_state_v2(uuid, text)
  to authenticated;

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
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_requeue boolean := false;
  v_queue_notification boolean := true;
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
  if v_attempt.status = 'canceled' then
    return true;
  end if;
  if v_attempt.status <> 'running' then
    raise exception 'scheduled_attempt_not_running' using errcode = '55000';
  end if;

  select * into v_occ
  from public.scheduled_task_occurrences
  where id = p_occurrence_id
    and task_id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_occurrence_not_found' using errcode = 'P0002';
  end if;

  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;
  if v_task.cancel_requested_at is null and v_task.deleted_at is null then
    raise exception 'scheduled_cancel_not_requested' using errcode = '55000';
  end if;

  -- owner_update_scheduled_task_v2 increments state_version and requests
  -- cancellation without setting a blocked reason. That means the immutable
  -- occurrence is obsolete but the newly edited task should remain scheduled.
  v_requeue := v_task.deleted_at is null
    and v_task.execution_blocked_reason is null
    and v_task.state_version <> v_occ.task_state_version;
  v_queue_notification := not v_requeue;

  update public.scheduled_task_attempts
  set
    status = 'canceled',
    failure_type = 'canceled',
    completed_at = now()
  where id = p_attempt_id;

  update public.scheduled_task_occurrences
  set
    status = 'canceled',
    failure_type = 'canceled',
    safe_error = case
      when v_requeue then 'Superseded by an owner edit.'
      else 'Canceled by owner request.'
    end,
    retry_after = null,
    completed_at = now(),
    updated_at = now()
  where id = p_occurrence_id;

  update public.scheduled_tasks
  set
    status = case when v_requeue then 'scheduled' else 'paused' end,
    worker_id = null,
    lease_expires_at = null,
    retry_after = null,
    retry_occurrence_id = null,
    execution_attempts = 0,
    cancel_requested_at = null,
    execution_blocked_reason = case
      when v_requeue then null
      else execution_blocked_reason
    end,
    updated_at = now()
  where id = p_task_id;

  if v_queue_notification then
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
      'canceled',
      'Scheduled task canceled.'
    ) on conflict (occurrence_id, channel, event_type) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.settle_scheduled_task_canceled_v2(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_scheduled_task_canceled_v2(uuid, uuid, uuid, uuid)
  to service_role;
