-- Bound Work sync storage, make mutation IDs request-specific, and ensure
-- deleting Work content removes its user-authored body while retaining the
-- small tombstone needed by offline clients.

create or replace function public.work_sync_request_fingerprint(p_request jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_request::text, 'UTF8')),
    'hex'
  )
$$;

create or replace function public.work_sync_payload_depth_allowed(
  p_value jsonb,
  p_remaining integer
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_child jsonb;
  v_type text;
begin
  if p_remaining < 0 or p_remaining > 16 then return false; end if;
  v_type := pg_catalog.jsonb_typeof(p_value);
  if p_remaining = 0 and v_type in ('object', 'array') then return false; end if;
  if v_type = 'object' then
    for v_child in
      select entry.value
      from pg_catalog.jsonb_each(p_value) as entry(key, value)
    loop
      if p_remaining = 0
         or not public.work_sync_payload_depth_allowed(v_child, p_remaining - 1) then
        return false;
      end if;
    end loop;
  elsif v_type = 'array' then
    for v_child in
      select entry.value
      from pg_catalog.jsonb_array_elements(p_value) as entry(value)
    loop
      if p_remaining = 0
         or not public.work_sync_payload_depth_allowed(v_child, p_remaining - 1) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

alter table public.work_sync_mutations
  add column operation text,
  add column request_fingerprint text;

-- Existing receipts predate request fingerprints. Preserve their best-effort
-- replay behavior, bind them to their operation/target in the replacement
-- functions below, and remove the duplicated user-authored body immediately.
update public.work_sync_mutations
set
  operation = case
    when result ? 'resourceType' then 'recent'
    when result ? 'kind' then 'save'
    else 'delete'
  end,
  request_fingerprint = 'legacy:' || public.work_sync_request_fingerprint(result),
  result = result - 'title' - 'payload';

alter table public.work_sync_mutations
  alter column operation set not null,
  alter column request_fingerprint set not null,
  add constraint work_sync_mutations_operation_check
    check (operation in ('save', 'delete', 'recent')),
  add constraint work_sync_mutations_fingerprint_check
    check (request_fingerprint ~ '^(legacy:)?[0-9a-f]{64}$'),
  add constraint work_sync_mutations_compact_result_check
    check (
      pg_catalog.octet_length(result::text) <= 2048
      and not (result ? 'title')
      and not (result ? 'payload')
    );

create index work_sync_mutations_owner_created_idx
  on public.work_sync_mutations (owner_id, created_at);

-- A Work tombstone needs only identity, kind, revision, clock and deletion
-- time. Remove bodies retained by the original migration before validating the
-- depth and account-export bounds below.
update public.work_saved_records
set title = 'Deleted Work item',
    payload = '{}'::jsonb
where deleted_at is not null;

alter table public.work_saved_records
  add constraint work_saved_records_payload_depth_check
    check (public.work_sync_payload_depth_allowed(payload, 16)),
  add constraint work_saved_records_deleted_body_check
    check (
      deleted_at is null
      or (title = 'Deleted Work item' and payload = '{}'::jsonb)
    );

-- Never silently discard active records during a forward migration. A prior
-- deployment that already exceeded the new eight-MiB compact-payload bound
-- must be remediated explicitly before this migration can proceed. Account
-- exports use compact JSON, so this leaves more than forty MiB for envelopes
-- and the account's other portable records.
do $work_sync_payload_preflight$
begin
  if exists (
    select 1
    from public.work_saved_records
    where deleted_at is null
    group by owner_id
    having pg_catalog.sum(pg_catalog.octet_length(payload::text)) > 8388608
  ) then
    raise exception 'work_sync_existing_payload_capacity_exceeded' using errcode = '54000';
  end if;
end
$work_sync_payload_preflight$;

create or replace function public.enforce_work_sync_receipt_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.work_sync_counters(owner_id)
  values (new.owner_id)
  on conflict (owner_id) do nothing;
  perform 1
  from public.work_sync_counters
  where owner_id = new.owner_id
  for update;
  delete from public.work_sync_mutations
  where owner_id = new.owner_id
    and created_at < now() - interval '7 days';
  if (
    select pg_catalog.count(*)
    from public.work_sync_mutations
    where owner_id = new.owner_id
  ) >= 10000 then
    raise exception 'work_sync_receipt_capacity' using errcode = 'P0003';
  end if;
  return new;
end;
$$;

create trigger enforce_work_sync_receipt_capacity
before insert on public.work_sync_mutations
for each row execute function public.enforce_work_sync_receipt_capacity();

create or replace function public.enforce_work_saved_payload_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_other_bytes bigint;
begin
  if new.deleted_at is not null then return new; end if;
  insert into public.work_sync_counters(owner_id)
  values (new.owner_id)
  on conflict (owner_id) do nothing;
  perform 1
  from public.work_sync_counters
  where owner_id = new.owner_id
  for update;
  select coalesce(
    pg_catalog.sum(pg_catalog.octet_length(record.payload::text)),
    0::bigint
  )
  into v_other_bytes
  from public.work_saved_records as record
  where record.owner_id = new.owner_id
    and record.id <> new.id
    and record.deleted_at is null;
  if v_other_bytes + pg_catalog.octet_length(new.payload::text) > 8388608 then
    raise exception 'work_sync_payload_capacity' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger enforce_work_saved_payload_capacity
before insert or update of owner_id, id, payload, deleted_at
on public.work_saved_records
for each row execute function public.enforce_work_saved_payload_capacity();

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
     or p_kind is null or p_kind not in ('task', 'template', 'agent_draft')
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
  return v_result;
end;
$$;

create or replace function public.delete_work_saved_record(
  p_user_id uuid,
  p_mutation_id uuid,
  p_id uuid,
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
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array('delete', p_id::text, p_expected_revision)
  );
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'delete'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and v_result ->> 'id' is distinct from p_id::text
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;
  select * into v_existing from public.work_saved_records
  where owner_id = p_user_id and id = p_id for update;
  if not found then raise exception 'work_record_not_found' using errcode = 'P0002'; end if;
  if v_existing.revision <> p_expected_revision then
    raise exception 'work_revision_conflict' using errcode = '40001';
  end if;
  if v_existing.deleted_at is not null then
    v_result := pg_catalog.jsonb_build_object(
      'id', p_id, 'revision', v_existing.revision,
      'syncVersion', v_existing.sync_version, 'deletedAt', v_existing.deleted_at
    );
    insert into public.work_sync_mutations(
      owner_id, mutation_id, operation, request_fingerprint, result
    ) values (
      p_user_id, p_mutation_id, 'delete', v_request_fingerprint, v_result
    );
    return v_result;
  end if;
  v_revision := v_existing.revision + 1;
  v_sync_version := public.next_work_sync_version(p_user_id);
  v_deleted_at := now();
  update public.work_saved_records set
    title = 'Deleted Work item',
    payload = '{}'::jsonb,
    revision = v_revision,
    sync_version = v_sync_version,
    deleted_at = v_deleted_at,
    updated_at = v_deleted_at
  where owner_id = p_user_id and id = p_id;
  v_result := pg_catalog.jsonb_build_object(
    'id', p_id, 'revision', v_revision,
    'syncVersion', v_sync_version, 'deletedAt', v_deleted_at
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'delete', v_request_fingerprint, v_result
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
     or p_resource_type not in ('run', 'task', 'template', 'agent_draft')
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
  return v_result;
end;
$$;

revoke all on function public.work_sync_request_fingerprint(jsonb)
  from public, anon, authenticated;
revoke all on function public.work_sync_payload_depth_allowed(jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.enforce_work_sync_receipt_capacity()
  from public, anon, authenticated;
revoke all on function public.enforce_work_saved_payload_capacity()
  from public, anon, authenticated;
revoke all on function public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)
  from public, anon, authenticated;
revoke all on function public.delete_work_saved_record(uuid,uuid,uuid,bigint)
  from public, anon, authenticated;
revoke all on function public.mutate_work_recent_item(uuid,uuid,text,uuid,text,bigint)
  from public, anon, authenticated;

grant execute on function public.work_sync_request_fingerprint(jsonb) to service_role;
grant execute on function public.work_sync_payload_depth_allowed(jsonb,integer) to service_role;
grant execute on function public.enforce_work_sync_receipt_capacity() to service_role;
grant execute on function public.enforce_work_saved_payload_capacity() to service_role;
grant execute on function public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)
  to service_role;
grant execute on function public.delete_work_saved_record(uuid,uuid,uuid,bigint)
  to service_role;
grant execute on function public.mutate_work_recent_item(uuid,uuid,text,uuid,text,bigint)
  to service_role;
