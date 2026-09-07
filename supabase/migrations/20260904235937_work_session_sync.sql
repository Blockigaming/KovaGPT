-- Extends the existing owner-scoped Work clock, receipts, quota and export model.
-- Session events describe user planning actions, never provider execution evidence.
alter table public.work_saved_records drop constraint work_saved_records_kind_check;
alter table public.work_saved_records add constraint work_saved_records_kind_check
  check (kind in ('task','template','agent_draft','session'));
alter table public.work_recent_items drop constraint work_recent_items_resource_type_check;
alter table public.work_recent_items add constraint work_recent_items_resource_type_check
  check (resource_type in ('run','task','template','agent_draft','session'));

create or replace function public.validate_work_session(
  p_owner uuid, p_id uuid, p_payload jsonb, p_previous jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_parent public.work_saved_records%rowtype;
  v_event jsonb;
  v_step jsonb;
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_count integer;
begin
  if p_payload->>'id' is distinct from p_id::text
    or coalesce(p_payload->>'rootId','') !~* v_uuid
    or jsonb_typeof(p_payload->'objective') is distinct from 'string'
    or char_length(btrim(p_payload->>'objective')) not between 1 and 4000
    or jsonb_typeof(p_payload->'context') is distinct from 'string'
    or char_length(p_payload->>'context') > 16000
    or coalesce(p_payload->>'status','') not in ('planning','paused','completed')
    or coalesce(p_payload->>'createdAt','') !~ '^\d{1,16}$'
    or coalesce(p_payload->>'updatedAt','') !~ '^\d{1,16}$'
    or jsonb_typeof(p_payload->'steps') is distinct from 'array'
    or jsonb_typeof(p_payload->'events') is distinct from 'array'
    or not p_payload ? 'parent' then
    raise exception 'work_session_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(p_payload->'steps') > 60
    or jsonb_array_length(p_payload->'events') not between 1 and 128 then
    raise exception 'work_session_limit' using errcode='22023';
  end if;
  for v_step in select value from jsonb_array_elements(p_payload->'steps') loop
    if coalesce(v_step->>'id','') !~* v_uuid
      or jsonb_typeof(v_step->'text') is distinct from 'string'
      or char_length(btrim(v_step->>'text')) not between 1 and 2000
      or jsonb_typeof(v_step->'done') is distinct from 'boolean' then
      raise exception 'work_session_step_invalid' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'steps'))
    <> jsonb_array_length(p_payload->'steps') then
    raise exception 'work_session_step_duplicate' using errcode='22023';
  end if;
  for v_event in select value from jsonb_array_elements(p_payload->'events') loop
    if coalesce(v_event->>'id','') !~* v_uuid
      or coalesce(v_event->>'at','') !~ '^\d{1,16}$'
      or coalesce(v_event->>'kind','') not in ('created','branched','plan_updated','step_updated','status_updated','conflict_resolved')
      or jsonb_typeof(v_event->'label') is distinct from 'string'
      or char_length(btrim(v_event->>'label')) not between 1 and 500 then
      raise exception 'work_session_event_invalid' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'events'))
    <> jsonb_array_length(p_payload->'events') then
    raise exception 'work_session_event_duplicate' using errcode='22023';
  end if;
  if p_previous is not null then
    if p_previous = '{}'::jsonb or p_previous->'rootId' is distinct from p_payload->'rootId'
      or p_previous->'parent' is distinct from p_payload->'parent'
      or p_previous->'createdAt' is distinct from p_payload->'createdAt' then
      raise exception 'work_session_lineage_immutable' using errcode='22023';
    end if;
    v_count := jsonb_array_length(p_previous->'events');
    if jsonb_array_length(p_payload->'events') < v_count then
      raise exception 'work_session_history_immutable' using errcode='22023';
    end if;
    if (p_previous - 'events' - 'updatedAt') is distinct from (p_payload - 'events' - 'updatedAt')
      and jsonb_array_length(p_payload->'events') <= v_count then
      raise exception 'work_session_event_required' using errcode='22023';
    end if;
    for v_index in 0..v_count-1 loop
      if (p_previous->'events')->v_index is distinct from (p_payload->'events')->v_index then
        raise exception 'work_session_history_immutable' using errcode='22023';
      end if;
    end loop;
  elsif p_payload->'parent' = 'null'::jsonb then
    if p_payload->>'rootId' <> p_id::text or p_payload->'events'->0->>'kind' <> 'created' then
      raise exception 'work_session_root_invalid' using errcode='22023';
    end if;
  else
    if coalesce(p_payload->'parent'->>'id','') !~* v_uuid
      or p_payload->'parent'->>'id' = p_id::text
      or coalesce(p_payload->'parent'->>'revision','') !~ '^[1-9]\d{0,15}$' then
      raise exception 'work_session_parent_invalid' using errcode='22023';
    end if;
    -- The caller already holds the owner's shared Work clock lock. Parent revision
    -- and branch creation therefore observe one serialized account snapshot.
    select * into v_parent from public.work_saved_records
      where owner_id=p_owner and id=(p_payload->'parent'->>'id')::uuid
        and kind='session' and deleted_at is null;
    if not found or v_parent.revision <> (p_payload->'parent'->>'revision')::bigint then
      raise exception 'work_session_parent_conflict' using errcode='40001';
    end if;
    if p_payload->'rootId' is distinct from v_parent.payload->'rootId'
      or p_payload->'events'->0->>'kind' <> 'branched' then
      raise exception 'work_session_parent_invalid' using errcode='22023';
    end if;
  end if;
end;
$$;
revoke all on function public.validate_work_session(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.validate_work_session(uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.upsert_work_saved_record(
  p_user_id uuid,
  p_mutation_id uuid,
  p_id uuid,
  p_kind text,
  p_title text,
  p_payload jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_saved_records%rowtype;
  v_result jsonb;
  v_receipt_operation text;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_revision bigint;
  v_sync_version bigint;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_kind is null or p_kind not in ('task', 'template', 'agent_draft', 'session')
     or p_expected_revision is null or p_expected_revision < 0
     or p_title is null or char_length(p_title) not between 1 and 160
     or p_title <> btrim(p_title) or p_title ~ '[[:cntrl:]]'
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 98304
     or not public.work_sync_payload_depth_allowed(p_payload, 16) then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;

  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array(
      'save', p_id::text, p_kind, p_title, p_payload, p_expected_revision
    )
  );
  insert into public.work_sync_counters(owner_id)
  values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;

  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'save'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and (
           v_result ->> 'id' is distinct from p_id::text
           or v_result ->> 'kind' is distinct from p_kind
         )
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select * into v_existing
  from public.work_saved_records
  where owner_id = p_user_id and id = p_id
  for update;

  if found then
    if v_existing.revision <> p_expected_revision then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if v_existing.kind <> p_kind then
      raise exception 'work_record_kind_immutable' using errcode = '22023';
    end if;
    if v_existing.deleted_at is not null and (
      select pg_catalog.count(*) from public.work_saved_records
      where owner_id = p_user_id and deleted_at is null
    ) >= 500 then
      raise exception 'work_saved_record_limit' using errcode = '22023';
    end if;
    v_revision := v_existing.revision + 1;
  else
    if p_expected_revision <> 0 then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if (select pg_catalog.count(*) from public.work_saved_records where owner_id = p_user_id) >= 2000
       or (
         select pg_catalog.count(*) from public.work_saved_records
         where owner_id = p_user_id and deleted_at is null
       ) >= 500 then
      raise exception 'work_saved_record_limit' using errcode = '22023';
    end if;
    v_revision := 1;
  end if;

  if p_kind = 'session' then
    perform public.validate_work_session(p_user_id,p_id,p_payload,v_existing.payload);
  end if;
  v_sync_version := public.next_work_sync_version(p_user_id);
  insert into public.work_saved_records(
    owner_id, id, kind, title, payload, revision, sync_version, deleted_at
  ) values (
    p_user_id, p_id, p_kind, p_title, p_payload, v_revision, v_sync_version, null
  )
  on conflict (owner_id, id) do update set
    title = excluded.title,
    payload = excluded.payload,
    revision = excluded.revision,
    sync_version = excluded.sync_version,
    deleted_at = null,
    updated_at = now();

  v_result := pg_catalog.jsonb_build_object(
    'id', p_id,
    'kind', p_kind,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', null,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'save', v_request_fingerprint, v_result
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work record synchronized', p_user_id, p_id::text, 'success',
    pg_catalog.jsonb_build_object('kind', p_kind, 'revision', v_revision)
  );
  return v_result;
end;
$$;


create or replace function public.mutate_work_recent_item(
  p_user_id uuid,
  p_mutation_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_operation text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_recent_items%rowtype;
  v_result jsonb;
  v_receipt_operation text;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_revision bigint;
  v_sync_version bigint;
  v_pinned_at timestamptz;
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_resource_id is null
     or p_resource_type is null
     or p_resource_type not in ('run', 'task', 'template', 'agent_draft', 'session')
     or p_operation is null or p_operation not in ('keep', 'pin', 'unpin', 'forget')
     or (p_operation <> 'keep' and (p_expected_revision is null or p_expected_revision < 0)) then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array(
      'recent', p_resource_type, p_resource_id::text, p_operation, p_expected_revision
    )
  );
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'recent'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and (
           v_result ->> 'resourceType' is distinct from p_resource_type
           or v_result ->> 'resourceId' is distinct from p_resource_id::text
         )
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if p_operation <> 'forget' then
    if p_resource_type = 'run' then
      if not exists (
        select 1 from public.agent_jobs
        where id = p_resource_id and owner_id = p_user_id
      ) then raise exception 'work_resource_not_found' using errcode = 'P0002'; end if;
    elsif not exists (
      select 1 from public.work_saved_records
      where owner_id = p_user_id and id = p_resource_id
        and kind = p_resource_type and deleted_at is null
    ) then raise exception 'work_resource_not_found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_existing from public.work_recent_items
  where owner_id = p_user_id and resource_type = p_resource_type
    and resource_id = p_resource_id for update;

  if found then
    if p_operation <> 'keep' and v_existing.revision <> p_expected_revision then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if v_existing.deleted_at is not null and p_operation <> 'forget' and (
      select pg_catalog.count(*) from public.work_recent_items
      where owner_id = p_user_id and deleted_at is null
    ) >= 500 then
      raise exception 'work_recent_limit' using errcode = '22023';
    end if;
    v_revision := v_existing.revision + 1;
    v_pinned_at := case
      when p_operation = 'pin' then now()
      when p_operation = 'unpin' then null
      else v_existing.pinned_at
    end;
  else
    if p_operation in ('unpin', 'forget') or coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if (select pg_catalog.count(*) from public.work_recent_items where owner_id = p_user_id) >= 2000
       or (
         select pg_catalog.count(*) from public.work_recent_items
         where owner_id = p_user_id and deleted_at is null
       ) >= 500 then
      raise exception 'work_recent_limit' using errcode = '22023';
    end if;
    v_revision := 1;
    v_pinned_at := case when p_operation = 'pin' then now() else null end;
  end if;

  v_sync_version := public.next_work_sync_version(p_user_id);
  v_deleted_at := case when p_operation = 'forget' then now() else null end;
  insert into public.work_recent_items(
    owner_id, resource_type, resource_id, pinned_at, last_opened_at,
    revision, sync_version, deleted_at
  ) values (
    p_user_id, p_resource_type, p_resource_id, v_pinned_at, now(),
    v_revision, v_sync_version, v_deleted_at
  )
  on conflict (owner_id, resource_type, resource_id) do update set
    pinned_at = excluded.pinned_at,
    last_opened_at = excluded.last_opened_at,
    revision = excluded.revision,
    sync_version = excluded.sync_version,
    deleted_at = excluded.deleted_at,
    updated_at = now();
  v_result := pg_catalog.jsonb_build_object(
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'pinnedAt', v_pinned_at,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', v_deleted_at,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'recent', v_request_fingerprint, v_result
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work recent state synchronized', p_user_id,
    p_resource_id::text, 'success',
    pg_catalog.jsonb_build_object('resource_type', p_resource_type, 'operation', p_operation)
  );
  return v_result;
end;
$$;

