-- Reusable workflow skills are owner-scoped instruction/resource packages.
-- Installations pin one immutable version. Package text never carries a tool,
-- credential, provider, entitlement, or execution grant.

create or replace function kova_private.workflow_skill_utf16_length(p_value text)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (
    length(p_value) +
    length(regexp_replace(p_value, E'[\\u0000-\\uFFFF]', '', 'g'))
  )::integer;
$$;

revoke all on function kova_private.workflow_skill_utf16_length(text)
  from public, anon, authenticated;
grant execute on function kova_private.workflow_skill_utf16_length(text) to service_role;

create table public.workflow_skills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision between 1 and 1000000),
  head_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.workflow_skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null,
  owner_id uuid not null,
  version integer not null check (version between 1 and 30),
  name text not null check (kova_private.workflow_skill_utf16_length(name) between 1 and 120),
  description text not null default ''
    check (kova_private.workflow_skill_utf16_length(description) <= 500),
  instructions text not null
    check (kova_private.workflow_skill_utf16_length(instructions) between 1 and 12000),
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 32000),
  created_at timestamptz not null default now(),
  foreign key (skill_id, owner_id)
    references public.workflow_skills(id, owner_id) on delete cascade,
  unique (skill_id, version),
  unique (skill_id, id)
);

alter table public.workflow_skills
  add constraint workflow_skills_head_version_fk
  foreign key (id, head_version_id)
  references public.workflow_skill_versions(skill_id, id)
  deferrable initially deferred;

create table public.workflow_skill_installations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  skill_id uuid not null,
  version_id uuid not null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (skill_id, owner_id)
    references public.workflow_skills(id, owner_id) on delete cascade,
  foreign key (skill_id, version_id)
    references public.workflow_skill_versions(skill_id, id) on delete cascade,
  unique (owner_id, skill_id),
  unique (id, owner_id)
);

create table public.workflow_skill_mutations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, mutation_id)
);

create index workflow_skills_owner_recent_idx
  on public.workflow_skills(owner_id, updated_at desc, id);
create index workflow_skill_versions_owner_idx
  on public.workflow_skill_versions(owner_id, skill_id, version desc);
create index workflow_skill_installations_owner_idx
  on public.workflow_skill_installations(owner_id, updated_at desc, id);

alter table public.workflow_skills enable row level security;
alter table public.workflow_skill_versions enable row level security;
alter table public.workflow_skill_installations enable row level security;
alter table public.workflow_skill_mutations enable row level security;

revoke all on public.workflow_skills from public, anon, authenticated;
revoke all on public.workflow_skill_versions from public, anon, authenticated;
revoke all on public.workflow_skill_installations from public, anon, authenticated;
revoke all on public.workflow_skill_mutations from public, anon, authenticated;
grant all on public.workflow_skills to service_role;
grant all on public.workflow_skill_versions to service_role;
grant all on public.workflow_skill_installations to service_role;
grant all on public.workflow_skill_mutations to service_role;

create or replace function kova_private.workflow_skill_principal_current(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1 from auth.users
      where id = p_user_id
        and deleted_at is null
        and email_confirmed_at is not null
        and not coalesce(is_anonymous, false)
        and (banned_until is null or banned_until <= now())
    )
    and not exists (
      select 1 from public.account_deletion_fences where user_id = p_user_id
    )
    and not exists (
      select 1 from public.banned_users where user_id = p_user_id
    );
$$;

revoke all on function kova_private.workflow_skill_principal_current(uuid)
  from public, anon, authenticated;
grant execute on function kova_private.workflow_skill_principal_current(uuid) to service_role;

-- Workflow history shares the account export's single 50 MiB artifact with
-- every direct and relationship-traversed database row. PostgreSQL's jsonb
-- text includes at least the bytes reserved by JSON.stringify for these rows,
-- so this conservative admission check can stop once the limit is crossed.
-- The historical function name is retained because this migration has already
-- been reviewed as part of the release contract.
create or replace function kova_private.account_export_direct_row_bytes(
  p_owner uuid,
  p_stop_after bigint
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  export_source record;
  source_bytes bigint;
  file_raw_bytes bigint;
  file_export_bytes bigint;
  missing_file_sizes bigint;
  total_bytes bigint := 0;
begin
  if p_owner is null or p_stop_after is null or p_stop_after not between 1 and 52428800 then
    raise exception 'account_export_size_invalid' using errcode = '22023';
  end if;

  for export_source in
    select source.table_name, source.owner_column
    from (values
      ('chat_history_records', 'owner_id'),
      ('custom_kova_export_rows', 'owner_id'),
      ('custom_kova_versions', 'owner_id'),
      ('custom_kova_link_grants', 'user_id'),
      ('custom_kova_mutations', 'owner_id'),
      ('custom_kova_reports', 'reporter_id'),
      ('custom_kova_moderation_events', 'actor_id'),
      ('google_connection_export_rows', 'user_id'),
      ('google_connection_preferences', 'user_id'),
      ('ai_generation_events', 'user_id'),
      ('ai_usage_events', 'user_id'),
      ('account_audit_entries', 'user_id'),
      ('agent_definitions', 'owner_id'),
      ('agent_definition_versions', 'owner_id'),
      ('agent_approvals', 'owner_id'),
      ('agent_deliverables', 'owner_id'),
      ('agent_jobs', 'owner_id'),
      ('agent_notifications', 'owner_id'),
      ('agent_resource_activity', 'owner_id'),
      ('agent_resource_audit', 'owner_id'),
      ('agent_resource_promotions', 'owner_id'),
      ('agent_resource_relationships', 'owner_id'),
      ('agent_run_events', 'owner_id'),
      ('agent_run_tasks', 'owner_id'),
      ('agent_runs', 'owner_id'),
      ('agent_specialist_tasks', 'owner_id'),
      ('agent_dependency_edges', 'owner_id'),
      ('agent_graph_preferences', 'owner_id'),
      ('app_admin_roles', 'user_id'),
      ('app_notifications', 'owner_id'),
      ('banned_users', 'user_id'),
      ('chat_branches', 'owner_id'),
      ('chat_custom_rules', 'owner_id'),
      ('chat_memories', 'user_id'),
      ('chat_context_summaries', 'user_id'),
      ('trusted_contact_export_rows', 'user_id'),
      ('trusted_contact_blocks', 'user_id'),
      ('chat_message_versions', 'owner_id'),
      ('chat_pinned_files', 'owner_id'),
      ('chat_share_links', 'user_id'),
      ('connected_account_audit_log', 'user_id'),
      ('connected_accounts', 'user_id'),
      ('context_packs', 'user_id'),
      ('daily_usage', 'user_id'),
      ('deep_research_evidence', 'user_id'),
      ('deep_research_runs', 'user_id'),
      ('developer_account_export_records', 'owner_id'),
      ('developer_funding_export_records', 'owner_id'),
      ('developer_pricing_draft_export_rows', 'owner_id'),
      ('developer_pricing_event_export_rows', 'owner_id'),
      ('developer_file_export_records', 'owner_id'),
      ('mcp_oauth_grant_export_rows', 'owner_id'),
      ('mcp_oauth_client_export_rows', 'owner_id'),
      ('discovery_usage_export_records', 'user_id'),
      ('feedback_submissions', 'owner_id'),
      ('financial_accounts', 'user_id'),
      ('financial_connections', 'owner_id'),
      ('github_accounts', 'owner_id'),
      ('github_coding_selections', 'owner_id'),
      ('github_installations', 'owner_id'),
      ('github_repositories', 'owner_id'),
      ('github_repository_branches', 'owner_id'),
      ('github_sync_records', 'owner_id'),
      ('github_tool_audit', 'owner_id'),
      ('github_webhooks', 'owner_id'),
      ('goal_milestones', 'owner_id'),
      ('goals', 'owner_id'),
      ('health_connections', 'owner_id'),
      ('integration_action_approvals', 'owner_id'),
      ('integration_audit_events', 'owner_id'),
      ('integration_consents', 'owner_id'),
      ('integration_deletion_requests', 'owner_id'),
      ('integration_linked_accounts', 'owner_id'),
      ('integration_sync_jobs', 'owner_id'),
      ('knowledge_relationships', 'owner_id'),
      ('kova_sites', 'owner_id'),
      ('kova_site_versions', 'owner_id'),
      ('kova_site_files', 'owner_id'),
      ('kova_site_aliases', 'owner_id'),
      ('kova_site_viewers', 'owner_id'),
      ('library_folders', 'user_id'),
      ('library_file_uploads', 'owner_id'),
      ('library_file_versions', 'owner_id'),
      ('library_file_replacements', 'owner_id'),
      ('library_text_versions', 'owner_id'),
      ('notification_deliveries', 'user_id'),
      ('notification_preferences', 'user_id'),
      ('onboarding_progress', 'user_id'),
      ('operational_events', 'owner_id'),
      ('organizations', 'created_by'),
      ('organization_members', 'user_id'),
      ('organization_scim_user_export_rows', 'user_id'),
      ('organization_invitations', 'recipient_user_id'),
      ('organization_audit_events', 'actor_user_id'),
      ('pending_tool_actions', 'user_id'),
      ('plaid_items', 'user_id'),
      ('prompt_evaluations', 'user_id'),
      ('prompt_templates', 'user_id'),
      ('prompt_versions', 'user_id'),
      ('project_template_audit_events', 'owner_id'),
      ('project_template_grants', 'owner_id'),
      ('project_template_versions', 'owner_id'),
      ('project_templates', 'owner_id'),
      ('research_templates', 'user_id'),
      ('safety_reports', 'reporter_id'),
      ('scheduled_task_runs', 'user_id'),
      ('scheduled_task_account_export', 'user_id'),
      ('scheduled_task_event_source_export_rows', 'user_id'),
      ('scheduled_tasks', 'user_id'),
      ('subscriptions', 'user_id'),
      ('support_tickets', 'owner_id'),
      ('user_library_items', 'user_id'),
      ('user_onboarding', 'user_id'),
      ('user_preferences', 'user_id'),
      ('user_storage', 'user_id'),
      ('work_recent_items', 'owner_id'),
      ('web_push_preferences', 'user_id'),
      ('web_push_subscription_export_rows', 'user_id'),
      ('work_execution_runs', 'owner_id'),
      ('work_browser_sessions', 'owner_id'),
      ('study_set_export_rows', 'owner_id'),
      ('work_execution_events', 'owner_id'),
      ('work_execution_outputs', 'owner_id'),
      ('work_saved_records', 'owner_id'),
      ('workflow_skill_export_rows', 'owner_id'),
      ('workflow_skill_versions', 'owner_id'),
      ('workflow_skill_installations', 'owner_id'),
      ('workflow_skill_mutation_export_rows', 'owner_id'),
      ('writing_document_versions', 'owner_id'),
      ('writing_documents', 'owner_id')
    ) as source(table_name, owner_column)
  loop
    execute format(
      'select coalesce(sum(octet_length(convert_to(to_jsonb(export_row)::text, ''UTF8'')) + 1), 0) from public.%I export_row where %I = $1',
      export_source.table_name,
      export_source.owner_column
    ) into source_bytes using p_owner;
    total_bytes := total_bytes + source_bytes;
    if total_bytes > p_stop_after then
      return total_bytes;
    end if;
  end loop;

  -- The exporter reserves these rows after its direct-table pass. Keep each
  -- read as a separate entry even when its result is later de-duplicated:
  -- account-export-pagination charges every database response before merging.
  for export_source in
    select source.table_name, source.row_filter
    from (values
      ('organization_invitations', 'export_row.invited_by = $1'),
      ('organization_audit_events', 'export_row.subject_user_id = $1'),
      ('projects', 'export_row.owner_id = $1'),
      ('project_members', 'export_row.user_id = $1'),
      ('project_comments', 'export_row.author_id = $1'),
      ('project_activity',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_chats',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_comments',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_files',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_invites',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_members',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_memory',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_notes',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_tasks',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('project_file_chunks',
        'export_row.file_id in (
          select project_file.id
          from public.project_files project_file
          where project_file.project_id in (
            select id from public.projects where owner_id = $1
          )
        )'),
      ('canvas_documents', 'export_row.private_owner_id = $1'),
      ('canvas_documents',
        'export_row.project_id in (select id from public.projects where owner_id = $1)'),
      ('canvas_revisions',
        'export_row.document_id in (
          select canvas.id
          from public.canvas_documents canvas
          where canvas.private_owner_id = $1
            or canvas.project_id in (
              select id from public.projects where owner_id = $1
            )
        )'),
      ('canvas_comments',
        'export_row.document_id in (
          select canvas.id
          from public.canvas_documents canvas
          where canvas.private_owner_id = $1
            or canvas.project_id in (
              select id from public.projects where owner_id = $1
            )
        )'),
      ('canvas_comments', 'export_row.author_id = $1'),
      ('canvas_documents',
        'export_row.id in (
          select authored.document_id
          from public.canvas_comments authored
          where authored.author_id = $1
        )'),
      ('family_groups', 'export_row.owner_id = $1'),
      ('family_members', 'export_row.user_id = $1'),
      ('family_members',
        'export_row.group_id in (select id from public.family_groups where owner_id = $1)'),
      ('family_invites',
        'export_row.group_id in (select id from public.family_groups where owner_id = $1)'),
      ('shared_chats', 'export_row.owner_user_id = $1'),
      ('shared_chats', 'export_row.recipient_user_id = $1'),
      ('project_template_grants', 'export_row.grantee_user_id = $1'),
      ('agent_job_events',
        'export_row.job_id in (select id from public.agent_jobs where owner_id = $1)'),
      ('integration_webhook_subscriptions',
        'export_row.linked_account_id in (
          select id from public.integration_linked_accounts where owner_id = $1
        )'),
      ('agent_resource_promotions',
        'export_row.destination_id in (
          select project_file.id
          from public.project_files project_file
          where project_file.project_id in (
              select id from public.projects where owner_id = $1
            )
            and (project_file.status is null or project_file.status = ''ready'')
        )'),
      ('agent_deliverables',
        'export_row.id in (
          select promotion.deliverable_id
          from public.agent_resource_promotions promotion
          where promotion.destination_type = ''project_file''
            and promotion.destination_id in (
              select project_file.id
              from public.project_files project_file
              where project_file.project_id in (
                  select id from public.projects where owner_id = $1
                )
                and (project_file.status is null or project_file.status = ''ready'')
            )
        )')
    ) as source(table_name, row_filter)
  loop
    execute format(
      'select coalesce(sum(octet_length(convert_to(to_jsonb(export_row)::text, ''UTF8'')) + 1), 0) from public.%I export_row where %s',
      export_source.table_name,
      export_source.row_filter
    ) into source_bytes using p_owner;
    total_bytes := total_bytes + source_bytes;
    if total_bytes > p_stop_after then
      return total_bytes;
    end if;
  end loop;

  -- collectFiles embeds these deduplicated Storage objects as base64 in the
  -- same account-export artifact. Reserve the expanded body and its JSON
  -- envelope, not only the database rows that reference it. The relational
  -- size is retained as a conservative fallback and storage.objects metadata
  -- wins whenever it reports a larger body.
  with file_candidates(bucket, path, content_type, declared_size) as (
    select
      'project-files'::text,
      project_file.storage_path,
      project_file.mime_type,
      project_file.size_bytes
    from public.project_files project_file
    join public.projects project on project.id = project_file.project_id
    where project.owner_id = p_owner
      and (project_file.status is null or project_file.status = 'ready')
      and project_file.kind is distinct from 'agent-deliverable'

    union all

    select
      split_part(deliverable.storage_reference, ':', 1),
      substring(
        deliverable.storage_reference
        from position(':' in deliverable.storage_reference) + 1
      ),
      project_file.mime_type,
      project_file.size_bytes
    from public.project_files project_file
    join public.projects project on project.id = project_file.project_id
    join public.agent_resource_promotions promotion
      on promotion.destination_id = project_file.id
      and promotion.destination_type = 'project_file'
    join public.agent_deliverables deliverable on deliverable.id = promotion.deliverable_id
    where project.owner_id = p_owner
      and (project_file.status is null or project_file.status = 'ready')
      and project_file.kind = 'agent-deliverable'
      and promotion.status = 'completed'
      and promotion.project_id = project_file.project_id
      and promotion.owner_id = project_file.uploaded_by
      and deliverable.owner_id = promotion.owner_id
      and deliverable.storage_reference ~ '^(agent-evidence|project-files):'

    union all

    select
      split_part(deliverable.storage_reference, ':', 1),
      substring(
        deliverable.storage_reference
        from position(':' in deliverable.storage_reference) + 1
      ),
      deliverable.mime_type,
      null::bigint
    from public.agent_deliverables deliverable
    where deliverable.owner_id = p_owner
      and deliverable.storage_reference ~ '^(agent-evidence|project-files):'

    union all

    select
      case
        when library_item.metadata->>'file_bucket' = 'library-files' then 'library-files'
        when library_item.file_url like 'agent-evidence:%' then 'agent-evidence'
        when library_item.file_url like 'project-files:%' then 'project-files'
        else 'library-images'
      end,
      case
        when library_item.file_url like 'agent-evidence:%'
          or library_item.file_url like 'project-files:%'
        then substring(library_item.file_url from position(':' in library_item.file_url) + 1)
        else library_item.file_url
      end,
      library_item.file_type,
      library_item.file_size
    from public.user_library_items library_item
    where library_item.user_id = p_owner
      and library_item.file_url is not null
      and library_item.file_url <> ''
      and (
        library_item.metadata->>'file_bucket' = 'library-files'
        or library_item.file_url like 'agent-evidence:%'
        or library_item.file_url like 'project-files:%'
        or library_item.file_url !~* '^[a-z][a-z0-9+.-]*:'
      )

    union all

    select
      'library-files'::text,
      version.storage_path,
      version.mime_type,
      version.size_bytes
    from public.library_file_versions version
    where version.owner_id = p_owner
      and version.state = 'ready'
      and not version.delete_requested
  ), normalized_candidates as (
    select
      bucket,
      path,
      max(declared_size) filter (where declared_size >= 0) as declared_size,
      max(
        octet_length(convert_to(to_jsonb(content_type)::text, 'UTF8'))
      ) as content_type_json_bytes
    from file_candidates
    where bucket in ('agent-evidence', 'project-files', 'library-files', 'library-images')
      and path is not null
      and path <> ''
    group by bucket, path
  ), candidate_sizes as (
    select
      candidate.bucket,
      candidate.path,
      candidate.content_type_json_bytes,
      greatest(
        candidate.declared_size,
        case
          when object.metadata->>'size' ~ '^[0-9]{1,18}$'
          then (object.metadata->>'size')::bigint
        end
      ) as size_bytes
    from normalized_candidates candidate
    left join storage.objects object
      on object.bucket_id = candidate.bucket and object.name = candidate.path
  ), bounded_sizes as (
    select
      bucket,
      path,
      content_type_json_bytes,
      case
        when size_bytes > p_stop_after then p_stop_after + 1
        else size_bytes
      end as size_bytes
    from candidate_sizes
  )
  select
    coalesce(sum(size_bytes), 0),
    coalesce(sum(
      4 * ((size_bytes + 2) / 3) +
      octet_length(convert_to(jsonb_build_object(
        'bucket', bucket,
        'path', path,
        'contentType', null,
        'sizeBytes', size_bytes,
        'sha256', repeat('0', 64),
        'base64', ''
      )::text, 'UTF8')) +
      greatest(coalesce(content_type_json_bytes, 4) - 4, 0) +
      1
    ), 0),
    count(*) filter (where size_bytes is null)
  into file_raw_bytes, file_export_bytes, missing_file_sizes
  from bounded_sizes;

  if missing_file_sizes > 0 or file_raw_bytes > 33554432 then
    return p_stop_after + 1;
  end if;
  total_bytes := total_bytes + file_export_bytes;
  if total_bytes > p_stop_after then
    return total_bytes;
  end if;
  return total_bytes;
end;
$$;

revoke all on function kova_private.account_export_direct_row_bytes(uuid, bigint)
  from public, anon, authenticated;
grant execute on function kova_private.account_export_direct_row_bytes(uuid, bigint)
  to service_role;

create or replace function public.list_workflow_skills()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  rows jsonb;
begin
  if not kova_private.workflow_skill_principal_current(actor) then
    raise exception 'workflow_skill_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id), '[]'::jsonb)
  into rows
  from (
    select
      skill.id,
      skill.revision,
      skill.head_version_id as "headVersionId",
      skill.created_at,
      skill.updated_at,
      version.version,
      version.name,
      version.description,
      version.instructions,
      version.resources,
      version.content_sha256 as digest,
      installation.id as "installationId",
      installation.version_id as "installedVersionId",
      installed_version.version as "installedVersion",
      installed_version.name as "installedName"
    from public.workflow_skills skill
    join public.workflow_skill_versions version on version.id = skill.head_version_id
    left join public.workflow_skill_installations installation
      on installation.skill_id = skill.id and installation.owner_id = actor
    left join public.workflow_skill_versions installed_version
      on installed_version.id = installation.version_id
      and installed_version.skill_id = installation.skill_id
    where skill.owner_id = actor
    order by skill.updated_at desc, skill.id
    limit 100
  ) item;
  return jsonb_build_object('rows', rows);
end;
$$;

create or replace function public.mutate_workflow_skill(
  p_action text,
  p_skill_id uuid,
  p_expected_revision bigint,
  p_payload jsonb,
  p_mutation_id uuid,
  p_requested_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  skill public.workflow_skills;
  version_row public.workflow_skill_versions;
  receipt public.workflow_skill_mutations;
  fingerprint text;
  result jsonb;
  resource jsonb;
  next_version integer;
  new_version_id uuid;
  installation_id uuid;
  payload_bytes integer;
  workflow_skill_bytes bigint;
  storage_limit bigint;
  name_text text;
  description_text text;
  instructions_text text;
  resource_title text;
  resource_content text;
  resource_count_text text;
  digest_input text;
  computed_digest text;
  rate_allowed boolean;
  mutation_error text;
  trim_characters constant text :=
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) ||
    chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) ||
    chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) ||
    chr(65279);
  prohibited_controls constant text :=
    chr(1) || chr(2) || chr(3) || chr(4) || chr(5) || chr(6) || chr(7) || chr(8) ||
    chr(11) || chr(12) || chr(14) || chr(15) || chr(16) || chr(17) || chr(18) ||
    chr(19) || chr(20) || chr(21) || chr(22) || chr(23) || chr(24) || chr(25) ||
    chr(26) || chr(27) || chr(28) || chr(29) || chr(30) || chr(31) || chr(127);
begin
  if p_action is null or p_action not in ('create', 'version', 'install', 'uninstall', 'delete')
    or p_mutation_id is null or p_requested_at is null
    or p_requested_at < now() - interval '7 days'
    or p_requested_at > now() + interval '5 minutes'
    or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception 'workflow_skill_invalid' using errcode = '22023';
  end if;
  -- Serialize every owner-scoped write with account deletion, then recheck the
  -- principal while holding the shared fence lock.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 20260903204500));
  if not kova_private.workflow_skill_principal_current(actor) then
    raise exception 'workflow_skill_denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text, 20260910210000));
  fingerprint := encode(
    sha256(convert_to(jsonb_build_object(
      'action', p_action,
      'skillId', p_skill_id,
      'expectedRevision', p_expected_revision,
      'payload', p_payload,
      'requestedAt', p_requested_at
    )::text, 'UTF8')),
    'hex'
  );
  select * into receipt from public.workflow_skill_mutations
    where owner_id = actor and mutation_id = p_mutation_id;
  if found then
    if receipt.request_hash <> fingerprint then
      raise exception 'workflow_skill_idempotency_conflict' using errcode = '40001';
    end if;
    return receipt.result;
  end if;

  -- Exact replays are free, while every new data-growing mutation consumes a
  -- durable distributed token before it can reach the full account-export
  -- scan. Because this call sits outside the subtransaction below, an export
  -- rejection still consumes its token and direct authenticated RPC calls
  -- cannot amplify the scan by rolling the limiter back.
  if p_action in ('create', 'version', 'install', 'uninstall') then
    select limiter.allowed into rate_allowed
    from public.consume_diagnostic_rate_limit(
      encode(sha256(convert_to(actor::text, 'UTF8')), 'hex'),
      'workflow_skill_mutation',
      12,
      3600
    ) limiter;
    if not coalesce(rate_allowed, false) then
      raise exception 'workflow_skill_rate_limit' using errcode = '54000';
    end if;
  end if;

  delete from public.workflow_skill_mutations
  where owner_id = actor
    and mutation_id in (
      select mutation_id from public.workflow_skill_mutations
      where owner_id = actor and created_at < now() - interval '8 days'
      order by created_at
      limit 100
    );
  if (select count(*) from public.workflow_skill_mutations where owner_id = actor) >= 10000 then
    raise exception 'workflow_skill_receipt_limit' using errcode = '54000';
  end if;

  begin
  if p_action = 'create' then
    if p_skill_id is not null or p_expected_revision <> 0 then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    if (select count(*) from public.workflow_skills where owner_id = actor) >= 100 then
      raise exception 'workflow_skill_capacity' using errcode = '54000';
    end if;
    insert into public.workflow_skills(owner_id) values (actor) returning * into skill;
  else
    select * into skill from public.workflow_skills
      where id = p_skill_id and owner_id = actor for update;
    if not found then
      raise exception 'workflow_skill_unavailable' using errcode = '42501';
    end if;
    if p_expected_revision is null or skill.revision <> p_expected_revision then
      raise exception 'workflow_skill_conflict' using errcode = '40001';
    end if;
  end if;

  if p_action in ('create', 'version') then
    if (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)
      is distinct from array['description', 'digest', 'instructions', 'name', 'resources']::text[]
      or jsonb_typeof(p_payload->'name') is distinct from 'string'
      or jsonb_typeof(p_payload->'description') is distinct from 'string'
      or jsonb_typeof(p_payload->'instructions') is distinct from 'string'
      or jsonb_typeof(p_payload->'resources') is distinct from 'array'
      or jsonb_typeof(p_payload->'digest') is distinct from 'string'
    then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    name_text := p_payload->>'name';
    description_text := p_payload->>'description';
    instructions_text := p_payload->>'instructions';
    if length(name_text) not between 1 and 120
      or length(description_text) > 500
      or length(instructions_text) not between 1 and 12000
      or kova_private.workflow_skill_utf16_length(name_text) not between 1 and 120
      or kova_private.workflow_skill_utf16_length(description_text) > 500
      or kova_private.workflow_skill_utf16_length(instructions_text) not between 1 and 12000
      or jsonb_array_length(p_payload->'resources') > 10
      or (p_payload->>'digest') !~ '^[a-f0-9]{64}$'
      or name_text is distinct from btrim(name_text, trim_characters)
      or description_text is distinct from btrim(description_text, trim_characters)
      or instructions_text is distinct from btrim(instructions_text, trim_characters)
      or name_text is distinct from translate(name_text, prohibited_controls, '')
      or description_text is distinct from translate(description_text, prohibited_controls, '')
      or instructions_text is distinct from translate(instructions_text, prohibited_controls, '')
    then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    payload_bytes :=
      octet_length(convert_to(name_text, 'UTF8')) +
      octet_length(convert_to(description_text, 'UTF8')) +
      octet_length(convert_to(instructions_text, 'UTF8'));
    resource_count_text := jsonb_array_length(p_payload->'resources')::text;
    digest_input :=
      octet_length(convert_to(name_text, 'UTF8'))::text || ':' || name_text ||
      octet_length(convert_to(description_text, 'UTF8'))::text || ':' || description_text ||
      octet_length(convert_to(instructions_text, 'UTF8'))::text || ':' || instructions_text ||
      octet_length(convert_to(resource_count_text, 'UTF8'))::text || ':' || resource_count_text;
    for resource in select value from jsonb_array_elements(p_payload->'resources') loop
      if jsonb_typeof(resource) is distinct from 'object' then
        raise exception 'workflow_skill_resource_invalid' using errcode = '22023';
      end if;
      if (select array_agg(key order by key) from jsonb_object_keys(resource) key)
        is distinct from array['content', 'title']::text[]
        or jsonb_typeof(resource->'title') is distinct from 'string'
        or jsonb_typeof(resource->'content') is distinct from 'string'
      then
        raise exception 'workflow_skill_resource_invalid' using errcode = '22023';
      end if;
      resource_title := resource->>'title';
      resource_content := resource->>'content';
      if length(resource_title) not between 1 and 120
        or length(resource_content) not between 1 and 8000
        or kova_private.workflow_skill_utf16_length(resource_title) not between 1 and 120
        or kova_private.workflow_skill_utf16_length(resource_content) not between 1 and 8000
        or resource_title is distinct from btrim(resource_title, trim_characters)
        or resource_content is distinct from btrim(resource_content, trim_characters)
        or resource_title is distinct from translate(resource_title, prohibited_controls, '')
        or resource_content is distinct from translate(resource_content, prohibited_controls, '')
      then
        raise exception 'workflow_skill_resource_invalid' using errcode = '22023';
      end if;
      payload_bytes := payload_bytes +
        octet_length(convert_to(resource_title, 'UTF8')) +
        octet_length(convert_to(resource_content, 'UTF8'));
      digest_input := digest_input ||
        octet_length(convert_to(resource_title, 'UTF8'))::text || ':' || resource_title ||
        octet_length(convert_to(resource_content, 'UTF8'))::text || ':' || resource_content;
    end loop;
    computed_digest := encode(sha256(convert_to(digest_input, 'UTF8')), 'hex');
    if computed_digest <> p_payload->>'digest' then
      raise exception 'workflow_skill_digest_mismatch' using errcode = '22023';
    end if;
    if payload_bytes > 32000 then
      raise exception 'workflow_skill_too_large' using errcode = '54000';
    end if;
    select coalesce(max(version), 0) + 1 into next_version
      from public.workflow_skill_versions where skill_id = skill.id;
    if next_version > 30 then
      raise exception 'workflow_skill_version_limit' using errcode = '54000';
    end if;
    insert into public.workflow_skill_versions(
      skill_id, owner_id, version, name, description, instructions, resources,
      content_sha256, size_bytes
    ) values (
      skill.id, actor, next_version, name_text, description_text,
      instructions_text, p_payload->'resources', computed_digest, payload_bytes
    ) returning id into new_version_id;
    -- Match the account export's serialized-row accounting, including JSON
    -- escaping and per-version metadata, instead of trusting raw text bytes.
    select coalesce(sum(
      octet_length(convert_to(to_jsonb(version_record)::text, 'UTF8')) + 1
    ), 0) into workflow_skill_bytes
      from public.workflow_skill_versions version_record where owner_id = actor;
    if workflow_skill_bytes > 32000000 then
      raise exception 'workflow_skill_export_limit' using errcode = '54000';
    end if;
    storage_limit := case public.effective_user_plan_tier(actor)
      when 'plus' then 26843545600
      when 'pro' then 26843545600
      else 524288000
    end;
    if not public.try_add_storage_bytes(actor, payload_bytes, storage_limit) then
      raise exception 'workflow_skill_storage_limit' using errcode = '54000';
    end if;
    update public.workflow_skills
      set head_version_id = new_version_id,
          revision = case when p_action = 'create' then revision else revision + 1 end,
          updated_at = now()
      where id = skill.id
      returning * into skill;
    if p_action = 'create' then
      insert into public.workflow_skill_installations(owner_id, skill_id, version_id)
      values (actor, skill.id, new_version_id)
      returning id into installation_id;
    end if;
  elsif p_action = 'install' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)
      is distinct from array['versionId']::text[]
      or coalesce(p_payload->>'versionId', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    select * into version_row from public.workflow_skill_versions
      where skill_id = skill.id and owner_id = actor and id = (p_payload->>'versionId')::uuid;
    if not found then
      raise exception 'workflow_skill_version_unavailable' using errcode = '42501';
    end if;
    new_version_id := version_row.id;
    insert into public.workflow_skill_installations(owner_id, skill_id, version_id)
    values (actor, skill.id, version_row.id)
    on conflict (owner_id, skill_id) do update
      set version_id = excluded.version_id, updated_at = now()
    returning id into installation_id;
    update public.workflow_skills
      set revision = revision + 1, updated_at = now()
      where id = skill.id and owner_id = actor
      returning * into skill;
  elsif p_action = 'uninstall' then
    if p_payload <> '{}'::jsonb then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    delete from public.workflow_skill_installations
      where owner_id = actor and skill_id = skill.id
      returning id into installation_id;
    if not found then
      raise exception 'workflow_skill_installation_unavailable' using errcode = '42501';
    end if;
    update public.workflow_skills
      set revision = revision + 1, updated_at = now()
      where id = skill.id and owner_id = actor
      returning * into skill;
  elsif p_action = 'delete' then
    if p_payload <> '{}'::jsonb then
      raise exception 'workflow_skill_invalid' using errcode = '22023';
    end if;
    select coalesce(sum(size_bytes), 0) into payload_bytes
      from public.workflow_skill_versions where skill_id = skill.id and owner_id = actor;
    delete from public.workflow_skills where id = skill.id and owner_id = actor;
    if payload_bytes > 0 then
      perform public.release_project_storage_bytes(actor, payload_bytes);
    end if;
  end if;

  result := jsonb_build_object(
    'id', skill.id,
    'revision', skill.revision,
    'versionId', new_version_id,
    'installationId', installation_id,
    'deleted', p_action = 'delete',
    'installed', p_action in ('create', 'install')
  );
  insert into public.workflow_skill_mutations(owner_id, mutation_id, request_hash, result)
    values (actor, p_mutation_id, fingerprint, result);
  -- Check after every row created by a data-growing mutation exists, including
  -- its replay receipt. Raising still rolls the whole transaction back,
  -- including any storage charge.
  if p_action in ('create', 'version', 'install', 'uninstall')
    and kova_private.account_export_direct_row_bytes(actor, 52428800) > 52428800
  then
    raise exception 'workflow_skill_export_limit' using errcode = '54000';
  end if;
  return result;
  exception
    when others then
      get stacked diagnostics mutation_error = message_text;
      if mutation_error = 'workflow_skill_export_limit' then
        return jsonb_build_object('errorCode', mutation_error);
      end if;
      raise;
  end;
end;
$$;

create or replace function public.resolve_workflow_skill(
  p_actor uuid,
  p_installation_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resolved jsonb;
begin
  if not kova_private.workflow_skill_principal_current(p_actor) then
    raise exception 'workflow_skill_denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'installationId', installation.id,
    'skillId', skill.id,
    'versionId', version.id,
    'version', version.version,
    'name', version.name,
    'description', version.description,
    'instructions', version.instructions,
    'resources', version.resources,
    'digest', version.content_sha256
  ) into resolved
  from public.workflow_skill_installations installation
  join public.workflow_skills skill
    on skill.id = installation.skill_id and skill.owner_id = installation.owner_id
  join public.workflow_skill_versions version
    on version.id = installation.version_id and version.skill_id = installation.skill_id
  where installation.id = p_installation_id
    and installation.owner_id = p_actor
    and installation.version_id = p_version_id;
  if resolved is null then
    raise exception 'workflow_skill_selection_changed' using errcode = '42501';
  end if;
  return resolved;
end;
$$;

revoke all on function public.list_workflow_skills() from public, anon, authenticated;
grant execute on function public.list_workflow_skills() to authenticated;
revoke all on function public.mutate_workflow_skill(text, uuid, bigint, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mutate_workflow_skill(text, uuid, bigint, jsonb, uuid, timestamptz)
  to authenticated;
revoke all on function public.resolve_workflow_skill(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_workflow_skill(uuid, uuid, uuid) to service_role;

create view public.workflow_skill_export_rows with (security_invoker = true) as
  select id, owner_id, revision, head_version_id, created_at, updated_at
  from public.workflow_skills;
revoke all on public.workflow_skill_export_rows from public, anon, authenticated;
grant select on public.workflow_skill_export_rows to service_role;

create view public.workflow_skill_mutation_export_rows with (security_invoker = true) as
  select owner_id, mutation_id, result, created_at
  from public.workflow_skill_mutations;
revoke all on public.workflow_skill_mutation_export_rows from public, anon, authenticated;
grant select on public.workflow_skill_mutation_export_rows to service_role;
