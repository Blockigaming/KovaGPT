-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 14 hardening:
-- - correct recurrence-function volatility
-- - settle task and run state together
-- - isolate notification failure from execution outcome
-- - keep all settlement entrypoints service-role only

alter function public.next_scheduled_task_occurrence(timestamptz, text)
  stable;

create or replace function public.settle_scheduled_task_success(
  p_task_id uuid,
  p_worker_id text,
  p_scheduled_for timestamptz,
  p_run_id text,
  p_result text
)
returns table (
  next_run_at timestamptz,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_next timestamptz;
  v_preview text;
  v_notify boolean := true;
  v_delivery text := 'pending';
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden'
      using errcode = '42501';
  end if;

  if nullif(trim(p_worker_id), '') is null
    or nullif(trim(p_run_id), '') is null then
    raise exception 'scheduled_execution_identity_required'
      using errcode = '22023';
  end if;

  select *
  into v_task
  from public.scheduled_tasks
  where id = p_task_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_expires_at > now()
  for update;

  if not found then
    raise exception 'scheduled_execution_lease_not_owned'
      using errcode = '55000';
  end if;

  v_next := public.next_scheduled_task_occurrence(
    p_scheduled_for,
    v_task.repeat
  );

  v_preview := left(
    regexp_replace(
      coalesce(nullif(trim(p_result), ''), 'Scheduled task completed.'),
      E'[\\r\\n\\t]+',
      ' ',
      'g'
    ),
    220
  );

  update public.scheduled_tasks
  set
    status = case
      when v_next is null then 'completed'
      else 'scheduled'
    end,
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

  update public.scheduled_task_runs
  set
    status = 'complete',
    completed_at = now(),
    result_summary = left(coalesce(p_result, ''), 12000),
    delivery_status = 'pending',
    failure_type = null,
    retry_eligible = false,
    next_run_at = v_next,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      'Task execution completed successfully.'
    )
  where id = p_run_id
    and task_id = p_task_id
    and user_id = v_task.user_id;

  if not found then
    raise exception 'scheduled_run_not_owned'
      using errcode = '55000';
  end if;

  select
    coalesce(np.in_app_enabled, true)
    and coalesce((np.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences np
  where np.user_id = v_task.user_id;

  if not found then
    v_notify := true;
  end if;

  if v_notify then
    begin
      insert into public.app_notifications (
        owner_id,
        type,
        title,
        safe_preview,
        action_url,
        source_entity,
        delivery_state
      )
      values (
        v_task.user_id,
        'task_result',
        left('Completed: ' || v_task.title, 240),
        v_preview,
        '/scheduled-tasks',
        'scheduled_task:' || v_task.id::text,
        'delivered'
      );

      insert into public.notification_deliveries (
        user_id,
        task_run_id,
        channel,
        status,
        preview,
        delivered_at
      )
      values (
        v_task.user_id,
        p_run_id,
        'in_app',
        'sent',
        v_preview,
        now()
      );

      v_delivery := 'sent';
    exception
      when others then
        v_delivery := 'failed';
    end;
  else
    v_delivery := 'not_configured';
  end if;

  update public.scheduled_task_runs
  set
    delivery_status = v_delivery,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_delivery = 'sent'
          then 'In-app notification recorded.'
        when v_delivery = 'not_configured'
          then 'In-app task notifications are disabled.'
        else 'Task completed, but notification delivery failed.'
      end
    )
  where id = p_run_id;

  return query
  select v_next, v_delivery;
end;
$$;

create or replace function public.settle_scheduled_task_failure(
  p_task_id uuid,
  p_worker_id text,
  p_run_id text,
  p_failure_type text,
  p_safe_error text,
  p_retryable boolean
)
returns table (
  retry_at timestamptz,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_retry_at timestamptz;
  v_should_retry boolean;
  v_error text;
  v_preview text;
  v_notify boolean := true;
  v_delivery text := 'pending';
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden'
      using errcode = '42501';
  end if;

  if p_failure_type not in (
    'temporary',
    'permanent',
    'authorization',
    'timeout'
  ) then
    raise exception 'invalid_failure_type'
      using errcode = '22023';
  end if;

  select *
  into v_task
  from public.scheduled_tasks
  where id = p_task_id
    and status = 'running'
    and worker_id = p_worker_id
  for update;

  if not found then
    raise exception 'scheduled_execution_lease_not_owned'
      using errcode = '55000';
  end if;

  v_error := left(
    coalesce(
      nullif(trim(p_safe_error), ''),
      'Scheduled task failed.'
    ),
    500
  );

  v_should_retry :=
    p_retryable
    and p_failure_type in ('temporary', 'timeout')
    and v_task.execution_attempts < 4;

  if v_should_retry then
    v_retry_at :=
      now() +
      case v_task.execution_attempts
        when 1 then interval '1 minute'
        when 2 then interval '5 minutes'
        else interval '15 minutes'
      end;
  else
    v_retry_at := null;
  end if;

  v_preview := left(
    regexp_replace(v_error, E'[\\r\\n\\t]+', ' ', 'g'),
    220
  );

  update public.scheduled_tasks
  set
    status = case
      when v_retry_at is null then 'failed'
      else 'scheduled'
    end,
    last_run_at = now(),
    worker_id = null,
    lease_expires_at = null,
    retry_after = v_retry_at,
    last_failure_type = p_failure_type,
    last_error = v_error,
    updated_at = now()
  where id = p_task_id;

  update public.scheduled_task_runs
  set
    status = 'failed',
    completed_at = now(),
    delivery_status = 'pending',
    failure_type = p_failure_type,
    retry_eligible = v_retry_at is not null,
    next_run_at = v_retry_at,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_retry_at is null
          then v_preview
        else left(
          v_preview || ' A bounded automatic retry was scheduled.',
          500
        )
      end
    )
  where id = p_run_id
    and task_id = p_task_id
    and user_id = v_task.user_id;

  if not found then
    raise exception 'scheduled_run_not_owned'
      using errcode = '55000';
  end if;

  select
    coalesce(np.in_app_enabled, true)
    and coalesce((np.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences np
  where np.user_id = v_task.user_id;

  if not found then
    v_notify := true;
  end if;

  if v_notify then
    begin
      insert into public.app_notifications (
        owner_id,
        type,
        title,
        safe_preview,
        action_url,
        source_entity,
        delivery_state
      )
      values (
        v_task.user_id,
        'task_failure',
        left('Task issue: ' || v_task.title, 240),
        case
          when v_retry_at is null then v_preview
          else left(
            v_preview || ' KovaGPT will retry automatically.',
            220
          )
        end,
        '/scheduled-tasks',
        'scheduled_task:' || v_task.id::text,
        'delivered'
      );

      insert into public.notification_deliveries (
        user_id,
        task_run_id,
        channel,
        status,
        preview,
        delivered_at
      )
      values (
        v_task.user_id,
        p_run_id,
        'in_app',
        'sent',
        v_preview,
        now()
      );

      v_delivery := 'sent';
    exception
      when others then
        v_delivery := 'failed';
    end;
  else
    v_delivery := 'not_configured';
  end if;

  update public.scheduled_task_runs
  set
    delivery_status = v_delivery,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_delivery = 'sent'
          then 'In-app failure notification recorded.'
        when v_delivery = 'not_configured'
          then 'In-app task notifications are disabled.'
        else 'Failure recorded, but notification delivery failed.'
      end
    )
  where id = p_run_id;

  return query
  select v_retry_at, v_delivery;
end;
$$;

revoke all on function public.settle_scheduled_task_success(
  uuid,
  text,
  timestamptz,
  text,
  text
) from public, anon, authenticated;

revoke all on function public.settle_scheduled_task_failure(
  uuid,
  text,
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function public.settle_scheduled_task_success(
  uuid,
  text,
  timestamptz,
  text,
  text
) to service_role;

grant execute on function public.settle_scheduled_task_failure(
  uuid,
  text,
  text,
  text,
  text,
  boolean
) to service_role;
;
