-- Scheduled Execution v2 delivery and observability protocol.
--
-- Source-only forward migration. It does not enable Scheduled Tasks, deploy an
-- Azure Job, apply itself to any database, or send external email.

alter table public.scheduled_task_delivery_outbox
  add column if not exists last_attempt_at timestamptz;

create index if not exists scheduled_task_delivery_outbox_processing_idx
  on public.scheduled_task_delivery_outbox (updated_at, id)
  where status = 'processing';

-- In-app delivery is entirely database-local and transactionally materializes
-- existing outbox rows into the user-owned notification center. No network call
-- or external provider is involved. Email is intentionally not handled here.
create or replace function public.deliver_scheduled_in_app_outbox_v2(
  p_limit integer default 50
)
returns table (
  claimed integer,
  sent integer,
  failed integer,
  disabled integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_task_delivery_outbox%rowtype;
  v_claimed integer := 0;
  v_sent integer := 0;
  v_failed integer := 0;
  v_disabled integer := 0;
  v_attempt integer;
  v_backoff_seconds integer;
  v_title text;
  v_type text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  for v_row in
    select outbox.*
    from public.scheduled_task_delivery_outbox outbox
    where outbox.channel = 'in_app'
      and outbox.status in ('pending', 'failed')
      and outbox.available_at <= now()
      and outbox.attempt_count < 8
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_claimed := v_claimed + 1;
    v_attempt := v_row.attempt_count + 1;

    update public.scheduled_task_delivery_outbox
    set
      status = 'processing',
      attempt_count = v_attempt,
      last_attempt_at = now(),
      last_safe_error = null,
      updated_at = now()
    where id = v_row.id;

    begin
      v_type := case
        when v_row.event_type = 'completed' then 'task_result'
        else 'task_failure'
      end;
      v_title := case v_row.event_type
        when 'completed' then 'Scheduled task completed'
        when 'failed' then 'Scheduled task failed'
        when 'canceled' then 'Scheduled task canceled'
        when 'missed' then 'Scheduled task missed'
        else 'Scheduled task update'
      end;

      insert into public.app_notifications (
        id,
        owner_id,
        type,
        title,
        safe_preview,
        action_url,
        source_entity,
        delivery_state,
        expires_at
      ) values (
        v_row.id,
        v_row.user_id,
        v_type,
        v_title,
        left(v_row.safe_preview, 500),
        '/scheduled-tasks',
        'scheduled-occurrence:' || v_row.occurrence_id::text,
        'delivered',
        now() + interval '90 days'
      )
      on conflict (id) do update set
        owner_id = excluded.owner_id,
        type = excluded.type,
        title = excluded.title,
        safe_preview = excluded.safe_preview,
        action_url = excluded.action_url,
        source_entity = excluded.source_entity,
        delivery_state = 'delivered',
        expires_at = excluded.expires_at;

      update public.scheduled_task_delivery_outbox
      set
        status = 'sent',
        delivered_at = coalesce(delivered_at, now()),
        last_safe_error = null,
        updated_at = now()
      where id = v_row.id;

      v_sent := v_sent + 1;
    exception
      when others then
        -- Never persist SQLERRM or provider/private content. The notification
        -- payload itself is already a bounded safe preview from settlement.
        if v_attempt >= 8 then
          update public.scheduled_task_delivery_outbox
          set
            status = 'disabled',
            last_safe_error = 'In-app delivery reached the retry limit.',
            updated_at = now()
          where id = v_row.id;
          v_disabled := v_disabled + 1;
        else
          v_backoff_seconds := least(3600, 30 * (1 << least(v_attempt - 1, 6)));
          update public.scheduled_task_delivery_outbox
          set
            status = 'failed',
            available_at = now() + make_interval(secs => v_backoff_seconds),
            last_safe_error = 'In-app delivery will be retried.',
            updated_at = now()
          where id = v_row.id;
          v_failed := v_failed + 1;
        end if;
    end;
  end loop;

  return query select v_claimed, v_sent, v_failed, v_disabled;
end;
$$;

-- Defensive recovery for any processing row left by a future external-delivery
-- implementation. The current in-app delivery function is one transaction and
-- cannot leave a committed processing row after a process crash.
create or replace function public.recover_stale_scheduled_delivery_v2(
  p_stale_seconds integer default 300,
  p_limit integer default 100
)
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

  with stale as (
    select outbox.id
    from public.scheduled_task_delivery_outbox outbox
    where outbox.status = 'processing'
      and coalesce(outbox.last_attempt_at, outbox.updated_at)
        <= now() - make_interval(secs => greatest(30, least(coalesce(p_stale_seconds, 300), 3600)))
    order by coalesce(outbox.last_attempt_at, outbox.updated_at), outbox.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  update public.scheduled_task_delivery_outbox outbox
  set
    status = case when outbox.attempt_count >= 8 then 'disabled' else 'failed' end,
    available_at = case
      when outbox.attempt_count >= 8 then outbox.available_at
      else now()
    end,
    last_safe_error = case
      when outbox.attempt_count >= 8 then 'Delivery recovery reached the retry limit.'
      else 'A stale delivery claim was recovered.'
    end,
    updated_at = now()
  from stale
  where outbox.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A single database-side readiness snapshot provides the metrics later consumed
-- by staging/production verification and Azure alerting. Queue depth itself is
-- not an outage until the configured backlog threshold is exceeded.
create or replace function public.scheduled_worker_readiness_v2(
  p_environment text,
  p_max_stale_seconds integer default 180,
  p_max_delivery_backlog integer default 100
)
returns table (
  ready boolean,
  status text,
  heartbeat_age_seconds integer,
  source_sha text,
  worker_revision text,
  due_tasks integer,
  running_attempts integer,
  expired_attempts integer,
  ready_deliveries integer,
  failed_deliveries integer,
  disabled_deliveries integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_heartbeat public.scheduled_worker_heartbeats%rowtype;
  v_age integer;
  v_due integer;
  v_running integer;
  v_expired integer;
  v_ready_delivery integer;
  v_failed_delivery integer;
  v_disabled_delivery integer;
  v_status text;
  v_ready boolean;
  v_stale_seconds integer;
  v_backlog_limit integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(p_environment), '') is null then
    raise exception 'scheduled_worker_environment_required' using errcode = '22023';
  end if;

  v_stale_seconds := greatest(30, least(coalesce(p_max_stale_seconds, 180), 3600));
  v_backlog_limit := greatest(0, least(coalesce(p_max_delivery_backlog, 100), 10000));

  select heartbeat.* into v_heartbeat
  from public.scheduled_worker_heartbeats heartbeat
  where heartbeat.environment = left(p_environment, 50);

  v_age := case
    when v_heartbeat.last_success_at is null then null
    else greatest(0, floor(extract(epoch from (now() - v_heartbeat.last_success_at))))::integer
  end;

  select count(*) into v_due
  from public.scheduled_tasks task
  where task.status = 'scheduled'
    and task.deleted_at is null
    and task.cancel_requested_at is null
    and coalesce(task.retry_after, task.next_run_at, task.run_at) <= now();

  select
    count(*) filter (where attempt.status = 'running'),
    count(*) filter (
      where attempt.status = 'running' and attempt.lease_expires_at <= now()
    )
  into v_running, v_expired
  from public.scheduled_task_attempts attempt;

  select
    count(*) filter (
      where outbox.channel = 'in_app'
        and outbox.status in ('pending', 'failed')
        and outbox.available_at <= now()
    ),
    count(*) filter (where outbox.status = 'failed'),
    count(*) filter (where outbox.status = 'disabled')
  into v_ready_delivery, v_failed_delivery, v_disabled_delivery
  from public.scheduled_task_delivery_outbox outbox;

  if v_heartbeat.environment is null then
    v_status := 'heartbeat_missing';
  elsif v_heartbeat.last_status = 'failed' then
    v_status := 'worker_failed';
  elsif v_heartbeat.last_success_at is null or v_age > v_stale_seconds then
    v_status := 'heartbeat_stale';
  elsif v_expired > 0 then
    v_status := 'expired_attempts';
  elsif v_ready_delivery > v_backlog_limit then
    v_status := 'delivery_backlog';
  elsif v_disabled_delivery > 0 then
    v_status := 'delivery_disabled';
  else
    v_status := 'ready';
  end if;

  v_ready := v_status = 'ready';

  return query select
    v_ready,
    v_status,
    v_age,
    v_heartbeat.source_sha,
    v_heartbeat.worker_revision,
    v_due,
    v_running,
    v_expired,
    v_ready_delivery,
    v_failed_delivery,
    v_disabled_delivery;
end;
$$;

revoke all on function public.deliver_scheduled_in_app_outbox_v2(integer)
  from public, anon, authenticated;
revoke all on function public.recover_stale_scheduled_delivery_v2(integer, integer)
  from public, anon, authenticated;
revoke all on function public.scheduled_worker_readiness_v2(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.deliver_scheduled_in_app_outbox_v2(integer)
  to service_role;
grant execute on function public.recover_stale_scheduled_delivery_v2(integer, integer)
  to service_role;
grant execute on function public.scheduled_worker_readiness_v2(text, integer, integer)
  to service_role;
