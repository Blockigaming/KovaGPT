-- Permit the trusted work state machine to persist validated specialist lifecycle changes.
-- The function remains service-role-only; owner/model/request inputs stay immutable.
create or replace function public.commit_work_execution(
  p_owner_id uuid, p_run_id uuid, p_mutation_id uuid, p_mutation_hash text,
  p_expected_revision bigint, p_state jsonb, p_runner_ready_until timestamptz default null,
  p_concurrency integer default 1
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.work_execution_runs%rowtype;
  v_receipt public.work_execution_receipts%rowtype;
  v_revision bigint;
  v_status text;
  v_setting jsonb;
  v_session public.work_saved_records%rowtype;
  v_output jsonb;
  v_notification boolean;
begin
  if p_owner_id is null or p_run_id is null or p_mutation_id is null or
     p_mutation_hash is null or p_mutation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'work_input_invalid' using errcode = '22023';
  end if;
  -- Same account-deletion lock as admission into other owned storage lifecycles.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 20260903204500));
  if not kova_private.auth_user_exists(p_owner_id) or
    exists(select 1 from public.account_deletion_fences where user_id = p_owner_id) then
    raise exception 'work_account_unavailable' using errcode = '42501';
  end if;
  select * into v_receipt from public.work_execution_receipts where owner_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.mutation_hash <> p_mutation_hash or v_receipt.run_id <> p_run_id then
      raise exception 'work_idempotency_conflict' using errcode = '40001';
    end if;
    select state into p_state from public.work_execution_runs where id = p_run_id and owner_id = p_owner_id;
    return jsonb_build_object('state', p_state, 'idempotent', true, 'appliedRevision', v_receipt.revision);
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text) > 262144 or
    p_state->>'protocol' is distinct from 'kova-work-v1' or p_state->>'id' is distinct from p_run_id::text or
    p_state->>'ownerId' is distinct from p_owner_id::text or
    coalesce(p_state->>'requestHash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'work_state_invalid' using errcode = '22023';
  end if;
  v_revision := (p_state->>'revision')::bigint;
  v_status := p_state->>'status';
  if v_revision is distinct from p_expected_revision + 1 or v_revision > 100000 then
    raise exception 'work_revision_invalid' using errcode = '40001';
  end if;
  select * into v_run from public.work_execution_runs where id = p_run_id for update;
  if found then
    if v_run.owner_id <> p_owner_id then raise exception 'work_owner_required' using errcode = '42501'; end if;
    if v_run.revision <> p_expected_revision then raise exception 'work_revision_conflict' using errcode = '40001'; end if;
    if (v_run.state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event','specialists'])
       is distinct from (p_state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event','specialists']) then
      raise exception 'work_immutable_input_changed' using errcode = '22023';
    end if;
    if v_run.status in ('completed','failed','cancelled') and v_status <> v_run.status then
      raise exception 'work_terminal_immutable' using errcode = '22023';
    end if;
  else
    if p_expected_revision <> 0 or v_status <> 'queued' or p_runner_ready_until is null or
      p_runner_ready_until <= clock_timestamp() or p_runner_ready_until > clock_timestamp() + interval '60 seconds' or
      p_concurrency not between 1 and 3 or coalesce(p_state->>'plan','') not in ('plus','pro') then
      raise exception 'work_admission_unavailable' using errcode = '55000';
    end if;
    select settings into v_setting from public.user_preferences where user_id = p_owner_id;
    if v_setting is not null and (jsonb_typeof(v_setting) <> 'object' or coalesce(v_setting->>'lockdown_mode','false') <> 'false') then
      raise exception 'work_lockdown_active' using errcode = '42501';
    end if;
    if (select count(*) from public.work_execution_runs where owner_id=p_owner_id and status not in ('completed','failed','cancelled')) >= p_concurrency or
       (select count(*) from public.work_execution_runs where owner_id=p_owner_id) >= 1000 then
      raise exception 'work_capacity_exceeded' using errcode = '54000';
    end if;
    if p_state#>>'{request,sessionId}' is not null then
      select * into v_session from public.work_saved_records where owner_id=p_owner_id and id=(p_state#>>'{request,sessionId}')::uuid for share;
      if not found or v_session.kind <> 'session' or v_session.deleted_at is not null or
        v_session.revision is distinct from (p_state#>>'{request,sessionRevision}')::bigint or
        p_state->'sessionContext' is distinct from jsonb_build_object('objective',v_session.payload->'objective','context',v_session.payload->'context','steps',v_session.payload->'steps') then
        raise exception 'work_session_conflict' using errcode = '40001';
      end if;
    elsif p_state#>>'{request,sessionRevision}' is not null or p_state->'sessionContext' is distinct from 'null'::jsonb then
      raise exception 'work_session_invalid' using errcode = '22023';
    end if;
    if p_state#>>'{request,projectId}' is not null and not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id
      where p.id=(p_state#>>'{request,projectId}')::uuid and p.deletion_requested_at is null and m.user_id=p_owner_id and m.role in ('owner','editor')) then
      raise exception 'work_output_project_access_required' using errcode='42501';
    end if;
  end if;
  if v_status = 'completed' then
    if jsonb_typeof(p_state->'outputRefs') is distinct from 'array' or jsonb_array_length(p_state->'outputRefs') not between 1 and 20 then
      raise exception 'work_outputs_required' using errcode='22023';
    end if;
    for v_output in select value from jsonb_array_elements(p_state->'outputRefs') loop
      if v_output->>'kind' is distinct from 'library' or not exists(select 1 from public.user_library_items where id=(v_output->>'id')::uuid and user_id=p_owner_id) then
        raise exception 'work_output_not_owned' using errcode='42501';
      end if;
      if not exists(select 1 from public.work_execution_outputs o join public.project_files f on f.id=o.project_file_id
        join public.projects p on p.id=f.project_id join public.project_members m on m.project_id=p.id and m.user_id=p_owner_id
        where o.id=(v_output->>'id')::uuid and o.run_id=p_run_id and o.owner_id=p_owner_id and f.status='ready'
          and f.content_sha256=o.sha256 and p.deletion_requested_at is null) then
        raise exception 'work_output_provenance_unavailable' using errcode='42501';
      end if;
    end loop;
  end if;
  if coalesce(p_state#>>'{event,kind}','') !~ '^[a-z_]{3,40}$' or octet_length((p_state->'event')::text)>16384 then
    raise exception 'work_event_invalid' using errcode='22023';
  end if;
  insert into public.work_execution_runs(id,owner_id,request_id,request_hash,revision,status,state)
    values(p_run_id,p_owner_id,(p_state#>>'{request,mutationId}')::uuid,p_state->>'requestHash',v_revision,v_status,p_state)
    on conflict(id) do update set revision=excluded.revision,status=excluded.status,state=excluded.state,updated_at=now();
  insert into public.work_execution_events(run_id,owner_id,revision,kind,detail)
    values(p_run_id,p_owner_id,v_revision,p_state#>>'{event,kind}',coalesce(p_state#>'{event,detail}','{}'::jsonb));
  insert into public.work_execution_receipts(owner_id,mutation_id,mutation_hash,run_id,revision)
    values(p_owner_id,p_mutation_id,p_mutation_hash,p_run_id,v_revision);
  v_notification := v_status in ('waiting_for_user','approval_required','completed','failed') and
    v_run.status is distinct from v_status and not exists(select 1 from public.notification_preferences
      where user_id=p_owner_id and (not in_app_enabled or categories->>'tasks'='false'));
  if v_notification then
    insert into public.app_notifications(owner_id,type,title,safe_preview,action_url,source_entity,delivery_state)
    values(p_owner_id,case when v_status='failed' then 'task_failure' else 'task_result' end,
      case when v_status='completed' then 'Work completed' when v_status='failed' then 'Work needs attention' else 'Work is waiting for you' end,
      'Open Work to review the current result or requested action.', '/work',
      'work-execution:'||p_run_id::text||':'||v_revision::text,'delivered');
  end if;
  return jsonb_build_object('state',p_state,'idempotent',false,'appliedRevision',v_revision);
end $$;
revoke all on function public.commit_work_execution(uuid,uuid,uuid,text,bigint,jsonb,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.commit_work_execution(uuid,uuid,uuid,text,bigint,jsonb,timestamptz,integer) to service_role;

