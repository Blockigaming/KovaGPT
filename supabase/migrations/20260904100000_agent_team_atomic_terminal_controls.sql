-- Atomically close historical Constellation runs while their execution runtime remains disabled.
-- This function is deliberately terminal-only: it cannot start, resume, retry, or approve work.

create or replace function public.control_disabled_agent_team_run(
  p_run_id uuid,
  p_command text,
  p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_run_status text;
  v_task_status text;
  v_now timestamptz := now();
begin
  if v_owner_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_command not in ('cancel', 'deny') then
    raise exception 'agent_team_execution_unavailable' using errcode = '0A000';
  end if;

  select status
    into v_run_status
    from public.agent_runs
   where id = p_run_id
     and owner_id = v_owner_id
   for update;
  if not found then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;

  if p_command = 'cancel' and v_run_status = 'cancelled' then
    return jsonb_build_object(
      'accepted', true,
      'command', p_command,
      'status', 'cancelled',
      'idempotent', true
    );
  end if;
  if v_run_status in ('completed', 'failed', 'cancelled') then
    raise exception 'invalid_agent_state_transition' using errcode = '40001';
  end if;

  if p_command = 'deny' then
    if p_task_id is null then
      raise exception 'task_id_required' using errcode = '22023';
    end if;
    select status
      into v_task_status
      from public.agent_run_tasks
     where id = p_task_id
       and run_id = p_run_id
       and owner_id = v_owner_id
     for update;
    if not found or v_task_status <> 'approval_needed' then
      raise exception 'approval_not_pending' using errcode = '40001';
    end if;
  end if;

  update public.agent_run_tasks
     set status = 'cancelled',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = coalesce(completed_at, v_now),
         updated_at = v_now
   where run_id = p_run_id
     and owner_id = v_owner_id
     and status in (
       'waiting',
       'queued',
       'leased',
       'running',
       'approval_needed',
       'retry_wait',
       'blocked'
     );

  update public.agent_runs
     set status = 'cancelled',
         cancellation_category =
           case when p_command = 'deny' then 'approval_denied' else 'user_requested' end,
         lease_owner = null,
         lease_expires_at = null,
         cancelled_at = v_now,
         updated_at = v_now
   where id = p_run_id
     and owner_id = v_owner_id
     and status = v_run_status;
  if not found then
    raise exception 'agent_run_state_changed' using errcode = '40001';
  end if;

  insert into public.agent_run_events(run_id, owner_id, kind, safe_payload)
  values (
    p_run_id,
    v_owner_id,
    case when p_command = 'deny' then 'approval' else 'log' end,
    jsonb_build_object(
      'command', p_command,
      'result', 'cancelled',
      'execution_enabled', false,
      'task_id', p_task_id
    )
  );

  return jsonb_build_object(
    'accepted', true,
    'command', p_command,
    'status', 'cancelled',
    'idempotent', false
  );
end;
$$;

revoke all on function public.control_disabled_agent_team_run(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.control_disabled_agent_team_run(uuid, text, uuid)
  to authenticated;
