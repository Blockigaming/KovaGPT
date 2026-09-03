-- Durable cross-device Work drafts, templates, and Recents pins.
-- Browser roles may read their own state. All mutations pass through the
-- authenticated Kova server and service-only, revision-checked RPCs.

create table public.work_sync_counters (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  current_version bigint not null default 0 check (current_version >= 0),
  updated_at timestamptz not null default now()
);

create table public.work_saved_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  kind text not null check (kind in ('task', 'template', 'agent_draft')),
  title text not null check (
    char_length(title) between 1 and 160
    and title = btrim(title)
    and title !~ '[[:cntrl:]]'
  ),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 98304
  ),
  revision bigint not null default 1 check (revision >= 1),
  sync_version bigint not null check (sync_version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index work_saved_records_owner_sync_idx
  on public.work_saved_records (owner_id, sync_version);
create index work_saved_records_owner_active_idx
  on public.work_saved_records (owner_id, kind, updated_at desc)
  where deleted_at is null;

create table public.work_recent_items (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check (resource_type in ('run', 'task', 'template', 'agent_draft')),
  resource_id uuid not null,
  pinned_at timestamptz,
  last_opened_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision >= 1),
  sync_version bigint not null check (sync_version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, resource_type, resource_id)
);

create index work_recent_items_owner_sync_idx
  on public.work_recent_items (owner_id, sync_version);
create index work_recent_items_owner_active_idx
  on public.work_recent_items (owner_id, pinned_at desc nulls last, last_opened_at desc)
  where deleted_at is null;

create table public.work_sync_mutations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, mutation_id)
);

create index work_sync_mutations_created_idx
  on public.work_sync_mutations (created_at);

alter table public.work_sync_counters enable row level security;
alter table public.work_saved_records enable row level security;
alter table public.work_recent_items enable row level security;
alter table public.work_sync_mutations enable row level security;

create policy work_saved_records_owner_read
  on public.work_saved_records
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy work_recent_items_owner_read
  on public.work_recent_items
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.work_sync_counters from public, anon, authenticated;
revoke all on table public.work_saved_records from public, anon, authenticated;
revoke all on table public.work_recent_items from public, anon, authenticated;
revoke all on table public.work_sync_mutations from public, anon, authenticated;
grant select on table public.work_saved_records to authenticated;
grant select on table public.work_recent_items to authenticated;
grant all on table public.work_sync_counters to service_role;
grant all on table public.work_saved_records to service_role;
grant all on table public.work_recent_items to service_role;
grant all on table public.work_sync_mutations to service_role;

create or replace function public.next_work_sync_version(p_user_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
begin
  update public.work_sync_counters
     set current_version = current_version + 1,
         updated_at = now()
   where owner_id = p_user_id
  returning current_version into v_version;
  if v_version is null then
    raise exception 'work_sync_counter_missing' using errcode = 'P0002';
  end if;
  return v_version;
end;
$$;

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
  v_revision bigint;
  v_sync_version bigint;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_kind not in ('task', 'template', 'agent_draft')
     or p_expected_revision is null or p_expected_revision < 0
     or p_title is null or char_length(p_title) not between 1 and 160
     or p_title <> btrim(p_title) or p_title ~ '[[:cntrl:]]'
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 98304 then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;

  insert into public.work_sync_counters(owner_id)
  values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;

  select result into v_result
    from public.work_sync_mutations
   where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then return v_result; end if;

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
      select count(*) from public.work_saved_records
       where owner_id = p_user_id and deleted_at is null
    ) >= 500 then
      raise exception 'work_saved_record_limit' using errcode = '22023';
    end if;
    v_revision := v_existing.revision + 1;
  else
    if p_expected_revision <> 0 then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if (select count(*) from public.work_saved_records where owner_id = p_user_id) >= 2000
       or (
         select count(*) from public.work_saved_records
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

  v_result := jsonb_build_object(
    'id', p_id,
    'kind', p_kind,
    'title', p_title,
    'payload', p_payload,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', null,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(owner_id, mutation_id, result)
  values (p_user_id, p_mutation_id, v_result);
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work record synchronized', p_user_id, p_id::text, 'success',
    jsonb_build_object('kind', p_kind, 'revision', v_revision)
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
  v_revision bigint;
  v_sync_version bigint;
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result into v_result from public.work_sync_mutations
   where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then return v_result; end if;
  select * into v_existing from public.work_saved_records
   where owner_id = p_user_id and id = p_id for update;
  if not found then raise exception 'work_record_not_found' using errcode = 'P0002'; end if;
  if v_existing.revision <> p_expected_revision then
    raise exception 'work_revision_conflict' using errcode = '40001';
  end if;
  if v_existing.deleted_at is not null then
    v_result := jsonb_build_object(
      'id', p_id, 'revision', v_existing.revision,
      'syncVersion', v_existing.sync_version, 'deletedAt', v_existing.deleted_at
    );
    insert into public.work_sync_mutations(owner_id, mutation_id, result)
    values (p_user_id, p_mutation_id, v_result);
    return v_result;
  end if;
  v_revision := v_existing.revision + 1;
  v_sync_version := public.next_work_sync_version(p_user_id);
  v_deleted_at := now();
  update public.work_saved_records set
    revision = v_revision,
    sync_version = v_sync_version,
    deleted_at = v_deleted_at,
    updated_at = v_deleted_at
  where owner_id = p_user_id and id = p_id;
  v_result := jsonb_build_object(
    'id', p_id, 'revision', v_revision,
    'syncVersion', v_sync_version, 'deletedAt', v_deleted_at
  );
  insert into public.work_sync_mutations(owner_id, mutation_id, result)
  values (p_user_id, p_mutation_id, v_result);
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work record deleted', p_user_id, p_id::text, 'success',
    jsonb_build_object('kind', v_existing.kind, 'revision', v_revision)
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
  v_revision bigint;
  v_sync_version bigint;
  v_pinned_at timestamptz;
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_resource_id is null
     or p_resource_type not in ('run', 'task', 'template', 'agent_draft')
     or p_operation not in ('keep', 'pin', 'unpin', 'forget')
     or (p_operation <> 'keep' and (p_expected_revision is null or p_expected_revision < 0)) then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result into v_result from public.work_sync_mutations
   where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then return v_result; end if;

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
      select count(*) from public.work_recent_items
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
    if (select count(*) from public.work_recent_items where owner_id = p_user_id) >= 2000
       or (
         select count(*) from public.work_recent_items
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
  v_result := jsonb_build_object(
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'pinnedAt', v_pinned_at,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', v_deleted_at,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(owner_id, mutation_id, result)
  values (p_user_id, p_mutation_id, v_result);
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work recent state synchronized', p_user_id,
    p_resource_id::text, 'success',
    jsonb_build_object('resource_type', p_resource_type, 'operation', p_operation)
  );
  return v_result;
end;
$$;

create or replace function public.purge_work_sync_receipts(p_before timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_before is null or p_before > now() - interval '7 days'
     or p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'work_sync_purge_invalid' using errcode = '22023';
  end if;
  with selected as (
    select owner_id, mutation_id from public.work_sync_mutations
     where created_at < p_before
     order by created_at
     limit p_limit
     for update skip locked
  ), removed as (
    delete from public.work_sync_mutations m using selected s
     where m.owner_id = s.owner_id and m.mutation_id = s.mutation_id
    returning 1
  )
  select count(*) into v_count from removed;
  return v_count;
end;
$$;

create or replace function public.get_work_sync_changes(
  p_user_id uuid,
  p_after_version bigint default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_version bigint;
  v_next_version bigint;
  v_saved jsonb;
  v_recent jsonb;
  v_has_more boolean;
begin
  if p_user_id is null or p_after_version is null or p_after_version < 0
     or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'work_sync_query_invalid' using errcode = '22023';
  end if;
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  select current_version into v_current_version
    from public.work_sync_counters
   where owner_id = p_user_id
   for share;

  with changes as (
    select
      r.sync_version,
      'saved'::text as change_type,
      jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'title', r.title,
        'payload', r.payload,
        'revision', r.revision,
        'syncVersion', r.sync_version,
        'deletedAt', r.deleted_at,
        'updatedAt', r.updated_at
      ) as payload
    from public.work_saved_records r
    where r.owner_id = p_user_id and r.sync_version > p_after_version
    union all
    select
      r.sync_version,
      'recent'::text as change_type,
      jsonb_build_object(
        'resourceType', r.resource_type,
        'resourceId', r.resource_id,
        'pinnedAt', r.pinned_at,
        'lastOpenedAt', r.last_opened_at,
        'revision', r.revision,
        'syncVersion', r.sync_version,
        'deletedAt', r.deleted_at,
        'updatedAt', r.updated_at
      ) as payload
    from public.work_recent_items r
    where r.owner_id = p_user_id and r.sync_version > p_after_version
    order by sync_version
    limit p_limit
  )
  select
    coalesce(jsonb_agg(payload order by sync_version) filter (where change_type = 'saved'), '[]'),
    coalesce(jsonb_agg(payload order by sync_version) filter (where change_type = 'recent'), '[]'),
    coalesce(max(sync_version), p_after_version)
  into v_saved, v_recent, v_next_version
  from changes;

  v_has_more := v_current_version > v_next_version;
  return jsonb_build_object(
    'savedRecords', v_saved,
    'recentItems', v_recent,
    'nextCursor', v_next_version,
    'currentVersion', v_current_version,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.next_work_sync_version(uuid) from public, anon, authenticated;
revoke all on function public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.delete_work_saved_record(uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.mutate_work_recent_item(uuid,uuid,text,uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.purge_work_sync_receipts(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.get_work_sync_changes(uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.next_work_sync_version(uuid) to service_role;
grant execute on function public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint) to service_role;
grant execute on function public.delete_work_saved_record(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.mutate_work_recent_item(uuid,uuid,text,uuid,text,bigint) to service_role;
grant execute on function public.purge_work_sync_receipts(timestamptz,integer) to service_role;
grant execute on function public.get_work_sync_changes(uuid,bigint,integer) to service_role;
