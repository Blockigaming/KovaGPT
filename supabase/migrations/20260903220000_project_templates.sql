-- Immutable, versioned Project templates with explicit view/copy grants.
-- Browser roles can only read authorized data. Every mutation is performed by
-- the authenticated Kova server through service-only, idempotent RPCs.

create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    char_length(name) between 1 and 100
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  description text check (description is null or char_length(description) <= 1000),
  current_version integer not null default 1 check (current_version >= 1),
  revision bigint not null default 1 check (revision >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_templates_owner_key unique (id, owner_id)
);

create index project_templates_owner_updated_idx
  on public.project_templates (owner_id, updated_at desc);
create index project_templates_owner_active_idx
  on public.project_templates (owner_id, updated_at desc)
  where archived_at is null;

create table public.project_template_versions (
  template_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 16384
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (template_id, version),
  foreign key (template_id, owner_id)
    references public.project_templates(id, owner_id) on delete cascade,
  check (created_by = owner_id)
);

create index project_template_versions_owner_idx
  on public.project_template_versions (owner_id, created_at desc);

create table public.project_template_grants (
  template_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  can_copy boolean not null default false,
  granted_by uuid not null references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (template_id, grantee_user_id),
  foreign key (template_id, owner_id)
    references public.project_templates(id, owner_id) on delete cascade,
  check (granted_by = owner_id),
  check (owner_id <> grantee_user_id)
);

create index project_template_grants_grantee_active_idx
  on public.project_template_grants (grantee_user_id, updated_at desc)
  where revoked_at is null;
create index project_template_grants_owner_idx
  on public.project_template_grants (owner_id, updated_at desc);

create table public.project_template_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null,
  event_type text not null check (
    event_type in ('created', 'version_published', 'shared', 'revoked', 'archived', 'copied')
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 2048
  ),
  created_at timestamptz not null default now()
);

create index project_template_audit_owner_created_idx
  on public.project_template_audit_events (owner_id, created_at desc);
create index project_template_audit_actor_created_idx
  on public.project_template_audit_events (actor_user_id, created_at desc);

create table public.project_template_mutations (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  operation text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (actor_user_id, mutation_id)
);

create index project_template_mutations_created_idx
  on public.project_template_mutations (created_at);

create or replace function public.project_template_snapshot_valid(p_snapshot jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_snapshot is not null
    and jsonb_typeof(p_snapshot) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(p_snapshot) key
      where key not in ('projectName', 'projectDescription', 'systemPrompt', 'color')
    )
    and jsonb_typeof(p_snapshot -> 'projectName') = 'string'
    and char_length(p_snapshot ->> 'projectName') between 1 and 100
    and (p_snapshot ->> 'projectName') = btrim(p_snapshot ->> 'projectName')
    and (p_snapshot ->> 'projectName') !~ '[[:cntrl:]]'
    and (
      not (p_snapshot ? 'projectDescription')
      or p_snapshot -> 'projectDescription' = 'null'::jsonb
      or (
        jsonb_typeof(p_snapshot -> 'projectDescription') = 'string'
        and char_length(p_snapshot ->> 'projectDescription') <= 1000
        and replace(replace(p_snapshot ->> 'projectDescription', E'\n', ''), E'\t', '')
          !~ '[[:cntrl:]]'
      )
    )
    and (
      not (p_snapshot ? 'systemPrompt')
      or p_snapshot -> 'systemPrompt' = 'null'::jsonb
      or (
        jsonb_typeof(p_snapshot -> 'systemPrompt') = 'string'
        and char_length(p_snapshot ->> 'systemPrompt') <= 4000
        and replace(replace(p_snapshot ->> 'systemPrompt', E'\n', ''), E'\t', '')
          !~ '[[:cntrl:]]'
      )
    )
    and jsonb_typeof(p_snapshot -> 'color') = 'string'
    and char_length(p_snapshot ->> 'color') between 1 and 24
    and (p_snapshot ->> 'color') ~ '^[A-Za-z0-9#_-]+$'
    and octet_length(p_snapshot::text) <= 16384;
$$;

alter table public.project_template_versions
  add constraint project_template_versions_snapshot_valid
  check (public.project_template_snapshot_valid(snapshot));

create or replace function public.create_project_template(
  p_owner_id uuid,
  p_mutation_id uuid,
  p_name text,
  p_description text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_result jsonb;
  v_operation constant text := 'create';
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
begin
  if p_owner_id is null or p_mutation_id is null or p_name is null
     or char_length(p_name) not between 1 and 100 or p_name <> btrim(p_name)
     or p_name ~ '[[:cntrl:]]'
     or (p_description is not null and char_length(p_description) > 1000)
     or not public.project_template_snapshot_valid(p_snapshot) then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'name', p_name, 'description', p_description, 'snapshot', p_snapshot
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 421));
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> v_operation or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  if (select count(*) from public.project_templates where owner_id = p_owner_id) >= 500
     or (
       select count(*) from public.project_templates
        where owner_id = p_owner_id and archived_at is null
     ) >= 100 then
    raise exception 'project_template_limit_reached' using errcode = '22023';
  end if;
  insert into public.project_templates(owner_id, name, description)
  values (p_owner_id, p_name, p_description)
  returning id into v_id;
  insert into public.project_template_versions(template_id, owner_id, version, snapshot, created_by)
  values (v_id, p_owner_id, 1, p_snapshot, p_owner_id);
  v_result := jsonb_build_object('templateId', v_id, 'version', 1, 'revision', 1);
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_owner_id, p_mutation_id, v_operation, v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (p_owner_id, p_owner_id, v_id, 'created', jsonb_build_object('version', 1));
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_owner_id, 'project_template', 'Project template created', p_owner_id,
    v_id::text, 'success', jsonb_build_object('operation', 'created', 'version', 1)
  );
  return v_result;
end;
$$;

create or replace function public.publish_project_template_version(
  p_owner_id uuid,
  p_mutation_id uuid,
  p_template_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_result jsonb;
  v_version integer;
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
begin
  if p_owner_id is null or p_mutation_id is null or p_template_id is null
     or p_expected_revision is null or p_expected_revision < 1
     or not public.project_template_snapshot_valid(p_snapshot) then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'templateId', p_template_id, 'expectedRevision', p_expected_revision, 'snapshot', p_snapshot
  )::text);
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> 'publish_version' or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  select * into v_template from public.project_templates
   where id = p_template_id and owner_id = p_owner_id for update;
  if not found then raise exception 'project_template_not_found' using errcode = 'P0002'; end if;
  if v_template.archived_at is not null then
    raise exception 'project_template_archived' using errcode = '22023';
  end if;
  if v_template.revision <> p_expected_revision then
    raise exception 'project_template_revision_conflict' using errcode = '40001';
  end if;
  v_version := v_template.current_version + 1;
  insert into public.project_template_versions(template_id, owner_id, version, snapshot, created_by)
  values (p_template_id, p_owner_id, v_version, p_snapshot, p_owner_id);
  update public.project_templates set
    current_version = v_version,
    revision = revision + 1,
    updated_at = now()
  where id = p_template_id;
  v_result := jsonb_build_object(
    'templateId', p_template_id, 'version', v_version, 'revision', p_expected_revision + 1
  );
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_owner_id, p_mutation_id, 'publish_version', v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (
    p_owner_id, p_owner_id, p_template_id, 'version_published',
    jsonb_build_object('version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.share_project_template(
  p_owner_id uuid,
  p_mutation_id uuid,
  p_template_id uuid,
  p_expected_revision bigint,
  p_grantee_user_id uuid,
  p_can_copy boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
begin
  if p_owner_id is null or p_mutation_id is null or p_template_id is null
     or p_grantee_user_id is null or p_grantee_user_id = p_owner_id
     or p_expected_revision is null or p_expected_revision < 1 or p_can_copy is null then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'templateId', p_template_id, 'expectedRevision', p_expected_revision,
    'granteeUserId', p_grantee_user_id, 'canCopy', p_can_copy
  )::text);
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> 'share' or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  if not exists (select 1 from auth.users where id = p_grantee_user_id) then
    raise exception 'project_template_grantee_not_found' using errcode = 'P0002';
  end if;
  select * into v_template from public.project_templates
   where id = p_template_id and owner_id = p_owner_id for update;
  if not found then raise exception 'project_template_not_found' using errcode = 'P0002'; end if;
  if v_template.archived_at is not null then
    raise exception 'project_template_archived' using errcode = '22023';
  end if;
  if v_template.revision <> p_expected_revision then
    raise exception 'project_template_revision_conflict' using errcode = '40001';
  end if;
  insert into public.project_template_grants(
    template_id, owner_id, grantee_user_id, can_copy, granted_by, revoked_at
  ) values (
    p_template_id, p_owner_id, p_grantee_user_id, p_can_copy, p_owner_id, null
  ) on conflict (template_id, grantee_user_id) do update set
    can_copy = excluded.can_copy,
    granted_by = excluded.granted_by,
    revoked_at = null,
    updated_at = now();
  update public.project_templates set revision = revision + 1, updated_at = now()
   where id = p_template_id;
  v_result := jsonb_build_object(
    'templateId', p_template_id, 'granteeUserId', p_grantee_user_id,
    'canCopy', p_can_copy, 'revision', p_expected_revision + 1
  );
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_owner_id, p_mutation_id, 'share', v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (
    p_owner_id, p_owner_id, p_template_id, 'shared',
    jsonb_build_object('granteeUserId', p_grantee_user_id, 'canCopy', p_can_copy)
  );
  return v_result;
end;
$$;

create or replace function public.revoke_project_template_grant(
  p_owner_id uuid,
  p_mutation_id uuid,
  p_template_id uuid,
  p_expected_revision bigint,
  p_grantee_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
begin
  if p_owner_id is null or p_mutation_id is null or p_template_id is null
     or p_grantee_user_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'templateId', p_template_id, 'expectedRevision', p_expected_revision,
    'granteeUserId', p_grantee_user_id
  )::text);
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> 'revoke' or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  select * into v_template from public.project_templates
   where id = p_template_id and owner_id = p_owner_id for update;
  if not found then raise exception 'project_template_not_found' using errcode = 'P0002'; end if;
  if v_template.revision <> p_expected_revision then
    raise exception 'project_template_revision_conflict' using errcode = '40001';
  end if;
  update public.project_template_grants set revoked_at = now(), updated_at = now()
   where template_id = p_template_id and grantee_user_id = p_grantee_user_id
     and revoked_at is null;
  if not found then raise exception 'project_template_grant_not_found' using errcode = 'P0002'; end if;
  update public.project_templates set revision = revision + 1, updated_at = now()
   where id = p_template_id;
  v_result := jsonb_build_object(
    'templateId', p_template_id, 'granteeUserId', p_grantee_user_id,
    'revoked', true, 'revision', p_expected_revision + 1
  );
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_owner_id, p_mutation_id, 'revoke', v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (
    p_owner_id, p_owner_id, p_template_id, 'revoked',
    jsonb_build_object('granteeUserId', p_grantee_user_id)
  );
  return v_result;
end;
$$;

create or replace function public.archive_project_template(
  p_owner_id uuid,
  p_mutation_id uuid,
  p_template_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
  v_archived_at timestamptz;
begin
  if p_owner_id is null or p_mutation_id is null or p_template_id is null
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'templateId', p_template_id, 'expectedRevision', p_expected_revision
  )::text);
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> 'archive' or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  select * into v_template from public.project_templates
   where id = p_template_id and owner_id = p_owner_id for update;
  if not found then raise exception 'project_template_not_found' using errcode = 'P0002'; end if;
  if v_template.revision <> p_expected_revision then
    raise exception 'project_template_revision_conflict' using errcode = '40001';
  end if;
  if v_template.archived_at is not null then
    raise exception 'project_template_archived' using errcode = '22023';
  end if;
  v_archived_at := now();
  update public.project_templates set
    archived_at = v_archived_at, revision = revision + 1, updated_at = v_archived_at
   where id = p_template_id;
  update public.project_template_grants set revoked_at = v_archived_at, updated_at = v_archived_at
   where template_id = p_template_id and revoked_at is null;
  v_result := jsonb_build_object(
    'templateId', p_template_id, 'archivedAt', v_archived_at,
    'revision', p_expected_revision + 1
  );
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_owner_id, p_mutation_id, 'archive', v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (p_owner_id, p_owner_id, p_template_id, 'archived', '{}'::jsonb);
  return v_result;
end;
$$;

create or replace function public.copy_project_template(
  p_user_id uuid,
  p_mutation_id uuid,
  p_template_id uuid,
  p_version integer,
  p_project_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_snapshot jsonb;
  v_result jsonb;
  v_project_id uuid;
  v_version integer;
  v_fingerprint text;
  v_receipt public.project_template_mutations%rowtype;
begin
  if p_user_id is null or p_mutation_id is null or p_template_id is null
     or (p_version is not null and p_version < 1)
     or p_project_limit not in (3, 25, 200) then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'templateId', p_template_id, 'version', p_version, 'projectLimit', p_project_limit
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 422));
  select * into v_receipt from public.project_template_mutations
   where actor_user_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.operation <> 'copy' or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'project_template_mutation_reused' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;
  select * into v_template from public.project_templates where id = p_template_id;
  if not found or v_template.archived_at is not null then
    raise exception 'project_template_not_found' using errcode = 'P0002';
  end if;
  if v_template.owner_id <> p_user_id and not exists (
    select 1 from public.project_template_grants
     where template_id = p_template_id and grantee_user_id = p_user_id
       and can_copy and revoked_at is null
  ) then
    raise exception 'project_template_copy_denied' using errcode = '42501';
  end if;
  v_version := coalesce(p_version, v_template.current_version);
  select snapshot into v_snapshot from public.project_template_versions
   where template_id = p_template_id and version = v_version;
  if not found then raise exception 'project_template_version_not_found' using errcode = 'P0002'; end if;
  if (
    select count(*) from public.projects
     where owner_id = p_user_id and archived_at is null
  ) >= p_project_limit then
    raise exception 'project_limit_reached' using errcode = '22023';
  end if;
  insert into public.projects(owner_id, name, description, system_prompt, color)
  values (
    p_user_id,
    v_snapshot ->> 'projectName',
    nullif(v_snapshot ->> 'projectDescription', ''),
    nullif(v_snapshot ->> 'systemPrompt', ''),
    v_snapshot ->> 'color'
  ) returning id into v_project_id;
  v_result := jsonb_build_object(
    'templateId', p_template_id, 'version', v_version, 'projectId', v_project_id
  );
  insert into public.project_template_mutations(
    actor_user_id, mutation_id, operation, request_fingerprint, result
  ) values (p_user_id, p_mutation_id, 'copy', v_fingerprint, v_result);
  insert into public.project_template_audit_events(
    owner_id, actor_user_id, template_id, event_type, metadata
  ) values (
    v_template.owner_id, p_user_id, p_template_id, 'copied',
    jsonb_build_object('version', v_version, 'projectId', v_project_id)
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'project_template', 'Project created from template', p_user_id,
    v_project_id::text, 'success',
    jsonb_build_object('operation', 'copied', 'templateId', p_template_id, 'version', v_version)
  );
  return v_result;
end;
$$;

create or replace function public.list_project_templates(p_user_id uuid, p_limit integer default 25)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'templates', coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'id', t.id,
      'ownerId', t.owner_id,
      'name', t.name,
      'description', t.description,
      'currentVersion', t.current_version,
      'revision', t.revision,
      'archivedAt', t.archived_at,
      'updatedAt', t.updated_at,
      'access', case when t.owner_id = p_user_id then 'owner' else 'shared' end,
      'canCopy', t.owner_id = p_user_id or coalesce(g.can_copy, false),
      'snapshot', v.snapshot,
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version', pv.version, 'createdAt', pv.created_at
        ) order by pv.version desc)
        from public.project_template_versions pv where pv.template_id = t.id
      ), '[]'::jsonb),
      'grants', case when t.owner_id = p_user_id then coalesce((
        select jsonb_agg(jsonb_build_object(
          'granteeUserId', pg.grantee_user_id,
          'canCopy', pg.can_copy,
          'revokedAt', pg.revoked_at,
          'updatedAt', pg.updated_at
        ) order by pg.updated_at desc)
        from public.project_template_grants pg where pg.template_id = t.id
      ), '[]'::jsonb) else '[]'::jsonb end
    ) item
    from public.project_templates t
    join public.project_template_versions v
      on v.template_id = t.id and v.version = t.current_version
    left join public.project_template_grants g
      on g.template_id = t.id and g.grantee_user_id = p_user_id and g.revoked_at is null
    where t.owner_id = p_user_id
       or (t.archived_at is null and g.grantee_user_id = p_user_id)
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 25), 50))
  ) listed;
$$;

create or replace function public.get_project_template_version(
  p_user_id uuid,
  p_template_id uuid,
  p_version integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates%rowtype;
  v_snapshot jsonb;
  v_version integer;
  v_can_copy boolean;
begin
  if p_user_id is null or p_template_id is null or (p_version is not null and p_version < 1) then
    raise exception 'project_template_input_invalid' using errcode = '22023';
  end if;
  select * into v_template from public.project_templates where id = p_template_id;
  if not found then raise exception 'project_template_not_found' using errcode = 'P0002'; end if;
  if v_template.owner_id = p_user_id then
    v_can_copy := true;
  else
    if v_template.archived_at is not null then
      raise exception 'project_template_not_found' using errcode = 'P0002';
    end if;
    select can_copy into v_can_copy from public.project_template_grants
     where template_id = p_template_id and grantee_user_id = p_user_id and revoked_at is null;
    if not found then raise exception 'project_template_permission_denied' using errcode = '42501'; end if;
  end if;
  v_version := coalesce(p_version, v_template.current_version);
  select snapshot into v_snapshot from public.project_template_versions
   where template_id = p_template_id and version = v_version;
  if not found then raise exception 'project_template_version_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'templateId', p_template_id, 'ownerId', v_template.owner_id,
    'name', v_template.name, 'description', v_template.description,
    'version', v_version, 'currentVersion', v_template.current_version,
    'revision', v_template.revision, 'canCopy', v_can_copy, 'snapshot', v_snapshot
  );
end;
$$;

create or replace function public.purge_project_template_mutation_receipts(
  p_before timestamptz,
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_before is null or p_before > now() - interval '7 days'
     or p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'project_template_purge_invalid' using errcode = '22023';
  end if;
  with doomed as (
    select actor_user_id, mutation_id from public.project_template_mutations
     where created_at < p_before order by created_at limit p_limit for update skip locked
  )
  delete from public.project_template_mutations m using doomed d
   where m.actor_user_id = d.actor_user_id and m.mutation_id = d.mutation_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter table public.project_templates enable row level security;
alter table public.project_template_versions enable row level security;
alter table public.project_template_grants enable row level security;
alter table public.project_template_audit_events enable row level security;
alter table public.project_template_mutations enable row level security;

create policy project_templates_authorized_read on public.project_templates
  for select to authenticated using (
    owner_id = (select auth.uid())
    or (
      archived_at is null and exists (
        select 1 from public.project_template_grants g
         where g.template_id = id and g.grantee_user_id = (select auth.uid())
           and g.revoked_at is null
      )
    )
  );
create policy project_template_versions_authorized_read on public.project_template_versions
  for select to authenticated using (
    exists (
      select 1 from public.project_templates t
       where t.id = template_id and (
         t.owner_id = (select auth.uid())
         or (
           t.archived_at is null and exists (
             select 1 from public.project_template_grants g
              where g.template_id = t.id and g.grantee_user_id = (select auth.uid())
                and g.revoked_at is null
           )
         )
       )
    )
  );
create policy project_template_grants_participant_read on public.project_template_grants
  for select to authenticated using (
    owner_id = (select auth.uid()) or grantee_user_id = (select auth.uid())
  );
create policy project_template_audit_participant_read on public.project_template_audit_events
  for select to authenticated using (
    owner_id = (select auth.uid()) or actor_user_id = (select auth.uid())
  );

revoke all on table public.project_templates from public, anon, authenticated;
revoke all on table public.project_template_versions from public, anon, authenticated;
revoke all on table public.project_template_grants from public, anon, authenticated;
revoke all on table public.project_template_audit_events from public, anon, authenticated;
revoke all on table public.project_template_mutations from public, anon, authenticated;
grant select on table public.project_templates to authenticated;
grant select on table public.project_template_versions to authenticated;
grant select on table public.project_template_grants to authenticated;
grant select on table public.project_template_audit_events to authenticated;
grant all on table public.project_templates to service_role;
grant all on table public.project_template_versions to service_role;
grant all on table public.project_template_grants to service_role;
grant all on table public.project_template_audit_events to service_role;
grant all on table public.project_template_mutations to service_role;

revoke all on function public.project_template_snapshot_valid(jsonb) from public, anon, authenticated;
revoke all on function public.create_project_template(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.publish_project_template_version(uuid,uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.share_project_template(uuid,uuid,uuid,bigint,uuid,boolean) from public, anon, authenticated;
revoke all on function public.revoke_project_template_grant(uuid,uuid,uuid,bigint,uuid) from public, anon, authenticated;
revoke all on function public.archive_project_template(uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.copy_project_template(uuid,uuid,uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.list_project_templates(uuid,integer) from public, anon, authenticated;
revoke all on function public.get_project_template_version(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.purge_project_template_mutation_receipts(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.project_template_snapshot_valid(jsonb) to service_role;
grant execute on function public.create_project_template(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.publish_project_template_version(uuid,uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.share_project_template(uuid,uuid,uuid,bigint,uuid,boolean) to service_role;
grant execute on function public.revoke_project_template_grant(uuid,uuid,uuid,bigint,uuid) to service_role;
grant execute on function public.archive_project_template(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.copy_project_template(uuid,uuid,uuid,integer,integer) to service_role;
grant execute on function public.list_project_templates(uuid,integer) to service_role;
grant execute on function public.get_project_template_version(uuid,uuid,integer) to service_role;
grant execute on function public.purge_project_template_mutation_receipts(timestamptz,integer) to service_role;
