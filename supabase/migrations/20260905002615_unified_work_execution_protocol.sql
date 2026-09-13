-- New protocol only. Legacy agent_jobs/agent_runs and disabled workers are unchanged.
-- All executable state is admitted by the authenticated application backend.
create table public.work_execution_runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision > 0),
  status text not null check (status in ('queued','running','waiting_for_user','approval_required','paused','completed','failed','cancelled')),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  next_dispatch_at timestamptz not null default now(),
  unique (owner_id, request_id),
  unique (id, owner_id)
);
create index work_execution_owner_updated_idx on public.work_execution_runs(owner_id, updated_at desc, id);
create index work_execution_dispatch_idx on public.work_execution_runs(next_dispatch_at,id) where status not in ('completed','failed');
create table public.work_execution_events (
  run_id uuid not null,
  owner_id uuid not null,
  revision bigint not null,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null default now(),
  primary key(run_id, revision),
  foreign key(run_id, owner_id) references public.work_execution_runs(id, owner_id) on delete cascade
);
create table public.work_execution_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  mutation_hash text not null check(mutation_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null,
  revision bigint not null,
  primary key(owner_id, mutation_id),
  foreign key(run_id, owner_id) references public.work_execution_runs(id, owner_id) on delete cascade
);
alter table public.work_execution_runs enable row level security;
alter table public.work_execution_events enable row level security;
alter table public.work_execution_receipts enable row level security;
create policy work_execution_owner_read on public.work_execution_runs for select to authenticated using(owner_id = (select auth.uid()));
create policy work_execution_event_owner_read on public.work_execution_events for select to authenticated using(owner_id = (select auth.uid()));
revoke all on public.work_execution_runs, public.work_execution_events, public.work_execution_receipts from public, anon, authenticated;
grant select on public.work_execution_runs, public.work_execution_events to authenticated;
grant select, insert, update, delete on public.work_execution_runs, public.work_execution_events, public.work_execution_receipts to service_role;

create function public.commit_work_execution(
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
    if (v_run.state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event'])
       is distinct from (p_state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event']) then
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

create function public.assert_work_execution_lease(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_runner_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_setting jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner_id) or exists(select 1 from public.account_deletion_fences where user_id=p_owner_id) then
    return false;
  end if;
  select settings into v_setting from public.user_preferences where user_id=p_owner_id;
  if v_setting is not null and (jsonb_typeof(v_setting)<>'object' or coalesce(v_setting->>'lockdown_mode','false')<>'false') then return false; end if;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id and status='running';
  return coalesce((v_state->>'epoch')::bigint=p_epoch and v_state->>'runnerId'=p_runner_id::text and
    (v_state#>>'{lease,expiresAt}')::numeric > extract(epoch from clock_timestamp())*1000 and
    ((v_state->>'deadline')::numeric > extract(epoch from clock_timestamp())*1000 or v_state->>'reconciling'='true'),false);
end $$;
revoke all on function public.assert_work_execution_lease(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.assert_work_execution_lease(uuid,uuid,bigint,uuid) to service_role;

create table public.work_execution_outputs (
  id uuid primary key references public.user_library_items(id) on delete cascade,
  owner_id uuid not null,
  run_id uuid not null,
  project_file_id uuid not null references public.project_files(id) on delete cascade,
  artifact_id uuid not null,
  epoch bigint not null,
  step_id uuid not null,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  foreign key(run_id,owner_id) references public.work_execution_runs(id,owner_id) on delete cascade,
  unique(run_id,artifact_id)
);
alter table public.work_execution_outputs enable row level security;
create policy work_output_owner_read on public.work_execution_outputs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.work_execution_outputs from public,anon,authenticated;
grant select on public.work_execution_outputs to authenticated;
grant select,insert,delete on public.work_execution_outputs to service_role;

create function public.publish_work_execution_output(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_receipt_epoch bigint,p_step_id uuid,
 p_input_hash text,p_project_file_id uuid,p_artifact_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_file public.project_files%rowtype; v_existing public.work_execution_outputs%rowtype; v_id uuid;
begin
  if not public.assert_work_execution_lease(p_owner_id,p_run_id,p_epoch,
    (select (state->>'runnerId')::uuid from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id)) then
    raise exception 'work_output_lease_stale' using errcode='42501';
  end if;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not coalesce(v_state->'stepIds' ? p_step_id::text,false) or coalesce(p_input_hash,'') !~ '^[a-f0-9]{64}$' or
    v_state#>>'{step,id}' is distinct from p_step_id::text or v_state#>>'{step,inputHash}' is distinct from p_input_hash or
    (v_state#>>'{step,epoch}')::bigint is distinct from p_receipt_epoch then
    raise exception 'work_output_provenance_invalid' using errcode='22023';
  end if;
  select * into v_file from public.project_files where id=p_project_file_id for share;
  if not found or v_file.status<>'ready' or v_file.content_sha256 is distinct from p_sha256 or
    v_file.size_bytes is distinct from p_size_bytes or v_file.mime_type is distinct from p_mime_type or
    v_file.project_id::text is distinct from v_state#>>'{request,projectId}' or
    not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id
      where p.id=v_file.project_id and p.deletion_requested_at is null and m.user_id=p_owner_id and m.role in ('owner','editor')) then
    raise exception 'work_output_project_access_required' using errcode='42501';
  end if;
  select * into v_existing from public.work_execution_outputs where run_id=p_run_id and artifact_id=p_artifact_id;
  if found then
    if v_existing.owner_id<>p_owner_id or v_existing.project_file_id<>p_project_file_id or v_existing.sha256<>p_sha256 or
      v_existing.input_hash<>p_input_hash or v_existing.epoch<>p_receipt_epoch or v_existing.step_id<>p_step_id then
      raise exception 'work_output_idempotency_conflict' using errcode='40001';
    end if;
    return jsonb_build_object('id',v_existing.id,'idempotent',true);
  end if;
  v_id:=gen_random_uuid();
  insert into public.user_library_items(id,user_id,title,item_type,source,file_name,file_type,file_size,file_url,metadata)
    values(v_id,p_owner_id,v_file.name,'document','other',v_file.name,p_mime_type,p_size_bytes,null,
      jsonb_build_object('work_output',true));
  insert into public.work_execution_outputs(id,owner_id,run_id,project_file_id,artifact_id,epoch,step_id,input_hash,sha256,size_bytes,mime_type)
    values(v_id,p_owner_id,p_run_id,p_project_file_id,p_artifact_id,p_receipt_epoch,p_step_id,p_input_hash,p_sha256,p_size_bytes,p_mime_type);
  return jsonb_build_object('id',v_id,'idempotent',false);
end $$;
revoke all on function public.publish_work_execution_output(uuid,uuid,bigint,bigint,uuid,text,uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.publish_work_execution_output(uuid,uuid,bigint,bigint,uuid,text,uuid,uuid,text,bigint,text) to service_role;

-- Work output visibility and Library provenance must commit together while the
-- current run is locked. An upload may finish after cancellation; its immutable
-- generation remains pending/retired unless this transaction still authorizes it.
create function public.publish_work_project_file(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_receipt_epoch bigint,p_step_id uuid,
 p_input_hash text,p_project_file_id uuid,p_attempt_id uuid,p_artifact_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_file public.project_files%rowtype; v_principal uuid; v_project uuid;
begin
  select * into v_file from public.project_files where id=p_project_file_id;
  if not found or v_file.uploaded_by is distinct from p_owner_id or
    v_file.upload_attempt_id is distinct from p_attempt_id then return false; end if;
  -- The generic artifact settlement uses this same sorted two-principal order.
  for v_principal in select distinct x from unnest(array[p_owner_id,v_file.storage_owner_id]) x order by x loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_principal::text,20260903204500));
  end loop;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not found or not public.assert_work_execution_lease(p_owner_id,p_run_id,p_epoch,(v_state->>'runnerId')::uuid) then return false; end if;
  if v_state#>>'{step,id}' is distinct from p_step_id::text or
    (v_state#>>'{step,epoch}')::bigint is distinct from p_receipt_epoch or
    v_state#>>'{step,inputHash}' is distinct from p_input_hash or
    v_state#>>'{step,receipt,ownerId}' is distinct from p_owner_id::text or
    v_state#>>'{step,receipt,runId}' is distinct from p_run_id::text or
    v_state#>>'{step,receipt,stepId}' is distinct from p_step_id::text or
    v_state#>>'{step,receipt,inputHash}' is distinct from p_input_hash or
    (v_state#>>'{step,receipt,epoch}')::bigint is distinct from p_receipt_epoch or
    not exists(select 1 from jsonb_array_elements(v_state#>'{step,receipt,outputs}') o
      where o->>'artifactId'=p_artifact_id::text and o->>'sha256'=p_sha256 and
        (o->>'bytes')::bigint=p_size_bytes and o->>'mimeType'=p_mime_type) then
    raise exception 'work_output_provenance_invalid' using errcode='22023';
  end if;
  select p.id into v_project from public.projects p where p.id=v_file.project_id and
    p.id::text=v_state#>>'{request,projectId}' and p.deletion_requested_at is null for share;
  if not found then return false; end if;
  perform 1 from public.project_members where project_id=v_project and user_id=p_owner_id and role in ('owner','editor') for share;
  if not found then return false; end if;
  select * into v_file from public.project_files where id=p_project_file_id for update;
  if v_file.uploaded_by is distinct from p_owner_id or v_file.upload_attempt_id is distinct from p_attempt_id or
    v_file.content_sha256 is distinct from p_sha256 or v_file.size_bytes is distinct from p_size_bytes or
    v_file.mime_type is distinct from p_mime_type then return false; end if;
  if v_file.status<>'ready' and not public.set_project_file_upload_state(p_project_file_id,p_attempt_id,'ready') then return false; end if;
  perform public.publish_work_execution_output(p_owner_id,p_run_id,p_epoch,p_receipt_epoch,p_step_id,
    p_input_hash,p_project_file_id,p_artifact_id,p_sha256,p_size_bytes,p_mime_type);
  return true;
end $$;
revoke all on function public.publish_work_project_file(uuid,uuid,bigint,bigint,uuid,text,uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.publish_work_project_file(uuid,uuid,bigint,bigint,uuid,text,uuid,uuid,uuid,text,bigint,text) to service_role;

create function public.next_work_execution_dispatch(p_runner_id uuid,p_build text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_run public.work_execution_runs%rowtype;
begin
  select * into v_run from public.work_execution_runs where next_dispatch_at<=clock_timestamp()
    and state->>'runnerId'=p_runner_id::text and state->>'runnerBuild'=p_build
    and (status='queued' or (status='running' and (state#>>'{lease,expiresAt}')::numeric<=extract(epoch from clock_timestamp())*1000)
      or (status in ('paused','cancelled') and state->'step'<>'null'::jsonb)
      or (status='paused' and jsonb_array_length(state->'outputRefs')>0))
    order by next_dispatch_at,id for update skip locked limit 1;
  if not found then return null;end if;
  update public.work_execution_runs set next_dispatch_at=clock_timestamp()+interval '30 seconds' where id=v_run.id;
  return jsonb_build_object('owner_id',v_run.owner_id,'state',v_run.state);
end $$;
revoke all on function public.next_work_execution_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.next_work_execution_dispatch(uuid,text) to service_role;
