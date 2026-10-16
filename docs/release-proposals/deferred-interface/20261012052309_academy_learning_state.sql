-- PROPOSED / UNAPPLIED. CLI generation unavailable: installed CLI cannot write its read-only home.
-- Dedicated account learning state; quiz records are never reused.
create table public.academy_learning_state (
 owner_id uuid not null references auth.users(id) on delete cascade,
 topic text not null check (char_length(topic) between 1 and 160 and topic ~ '^[a-z0-9]+([/-][a-z0-9]+)*$'),
 revision bigint not null check(revision>0), body jsonb not null,
 last_mutation_id uuid not null, last_mutation_hash text not null,
 updated_at timestamptz not null default now(), primary key(owner_id,topic)
);
alter table public.academy_learning_state enable row level security;
create policy academy_owner_read on public.academy_learning_state for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.academy_learning_state from public,anon,authenticated;
grant select on public.academy_learning_state to authenticated;
grant all on public.academy_learning_state to service_role;
create table public.academy_write_windows (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 window_started_at timestamptz not null, writes integer not null check(writes between 1 and 20)
);
alter table public.academy_write_windows enable row level security;
revoke all on public.academy_write_windows from public,anon,authenticated;
grant all on public.academy_write_windows to service_role;
create function kova_private.save_academy_learning_state(p_topic text,p_expected_revision bigint,p_mutation_id uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); row_value public.academy_learning_state; digest text; win public.academy_write_windows; clock_value timestamptz:=clock_timestamp();
begin
 if actor is null then raise exception 'academy_denied' using errcode='42501'; end if;
 if p_topic is null or char_length(p_topic) not between 1 and 160 or p_topic !~ '^[a-z0-9]+([/-][a-z0-9]+)*$'
 or p_expected_revision is null or p_expected_revision<0 or p_mutation_id is null
 or p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>100000
 or not(p_body ?& array['notes','completed','checked']) or (p_body-array['notes','completed','checked'])<>'{}'::jsonb
 or jsonb_typeof(p_body->'notes')<>'string' or kova_private.workflow_skill_utf16_length(p_body->>'notes')>20000
 or jsonb_typeof(p_body->'completed')<>'boolean' or jsonb_typeof(p_body->'checked')<>'array'
 then raise exception 'academy_invalid' using errcode='22023'; end if;
 if jsonb_array_length(p_body->'checked')>100 or exists(select 1 from jsonb_array_elements(p_body->'checked') x where jsonb_typeof(x)<>'string' or kova_private.workflow_skill_utf16_length(x#>>'{}')>2000)
 then raise exception 'academy_invalid' using errcode='22023'; end if;
 -- Match the official reader: UTF-16 units above and 90,000 UTF-8 bytes of
 -- compact JSON below. jsonb::text inserts spaces and is not that wire budget.
 if octet_length(pg_catalog.convert_to(
   '{"notes":'||to_json(p_body->>'notes')::text||',"completed":'||(p_body->>'completed')||',"checked":['||
   coalesce((select string_agg(to_json(x#>>'{}')::text,',') from jsonb_array_elements(p_body->'checked') x),'')||']}', 'UTF8'))>90000
 then raise exception 'academy_invalid' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20260903204500));
 if not kova_private.auth_user_exists(actor) or exists(select 1 from public.account_deletion_fences where user_id=actor) then raise exception 'academy_denied' using errcode='42501'; end if;
 digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('topic',p_topic,'revision',p_expected_revision,'body',p_body)::text,'UTF8')),'hex');
 select * into row_value from public.academy_learning_state where owner_id=actor and topic=p_topic for update;
 if found then
   if row_value.last_mutation_id=p_mutation_id then
     if row_value.last_mutation_hash<>digest then raise exception 'academy_conflict' using errcode='40001'; end if;
     return to_jsonb(row_value)-'last_mutation_id'-'last_mutation_hash';
   end if;
   if row_value.revision<>p_expected_revision then raise exception 'academy_conflict' using errcode='40001'; end if;
 else
   if p_expected_revision<>0 then raise exception 'academy_conflict' using errcode='40001'; end if;
   if (select count(*) from public.academy_learning_state where owner_id=actor)>=100 then raise exception 'academy_capacity' using errcode='54000'; end if;
 end if;
 select * into win from public.academy_write_windows where owner_id=actor for update;
 if found and win.window_started_at>clock_value-interval '1 minute' and win.writes>=20 then raise exception 'academy_write_limited' using errcode='54000'; end if;
 insert into public.academy_write_windows values(actor,clock_value,1) on conflict(owner_id) do update set
 window_started_at=case when academy_write_windows.window_started_at<=clock_value-interval '1 minute' then clock_value else academy_write_windows.window_started_at end,
 writes=case when academy_write_windows.window_started_at<=clock_value-interval '1 minute' then 1 else academy_write_windows.writes+1 end;
 insert into public.academy_learning_state values(actor,p_topic,1,p_body,p_mutation_id,digest,clock_value)
 on conflict(owner_id,topic) do update set revision=academy_learning_state.revision+1,body=p_body,last_mutation_id=p_mutation_id,last_mutation_hash=digest,updated_at=clock_value returning * into row_value;
 return to_jsonb(row_value)-'last_mutation_id'-'last_mutation_hash';
end $$;
revoke all on function kova_private.save_academy_learning_state(text,bigint,uuid,jsonb) from public,anon;
grant execute on function kova_private.save_academy_learning_state(text,bigint,uuid,jsonb) to authenticated;
create function public.save_academy_learning_state(p_topic text,p_expected_revision bigint,p_mutation_id uuid,p_body jsonb)
returns jsonb language sql security invoker set search_path='' as $$select kova_private.save_academy_learning_state(p_topic,p_expected_revision,p_mutation_id,p_body)$$;
revoke all on function public.save_academy_learning_state(text,bigint,uuid,jsonb) from public,anon;
grant execute on function public.save_academy_learning_state(text,bigint,uuid,jsonb) to authenticated;
create view public.academy_learning_export_rows with(security_invoker=true) as select owner_id,topic,revision,body,updated_at from public.academy_learning_state;
revoke all on public.academy_learning_export_rows from public,anon;
grant select on public.academy_learning_export_rows to authenticated,service_role;

-- Extend the existing complete export admission calculation with Academy rows.
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
  account_envelope_bytes bigint;
  fixed_envelope_bytes constant bigint := 65536;
  total_bytes bigint := 0;
begin
  if p_owner is null or p_stop_after is null or p_stop_after not between 1 and 52428800 then
    raise exception 'account_export_size_invalid' using errcode = '22023';
  end if;

  -- Reserve the complete non-row envelope before any workflow data is
  -- admitted. 64 KiB conservatively covers the statically bounded outer
  -- object, format/version/export identifiers, timestamp, fixed notes, every
  -- record key and empty-array delimiter, and the transformed account-object
  -- field names. Account-specific Auth values are charged separately using
  -- their full database JSON, which is larger than the sanitized API shape.
  select
    fixed_envelope_bytes +
    coalesce((
      select sum(octet_length(convert_to(to_jsonb(auth_user)::text, 'UTF8')) + 1)
      from auth.users auth_user where auth_user.id = p_owner
    ), 0) +
    coalesce((
      select sum(octet_length(convert_to(to_jsonb(identity_row)::text, 'UTF8')) + 1)
      from auth.identities identity_row where identity_row.user_id = p_owner
    ), 0) +
    coalesce((
      select sum(octet_length(convert_to(to_jsonb(factor_row)::text, 'UTF8')) + 1)
      from auth.mfa_factors factor_row where factor_row.user_id = p_owner
    ), 0)
  into account_envelope_bytes;
  total_bytes := account_envelope_bytes;
  if total_bytes > p_stop_after then
    return total_bytes;
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
      ('academy_learning_export_rows', 'owner_id'),
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

