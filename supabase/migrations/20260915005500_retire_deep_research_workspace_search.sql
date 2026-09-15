-- Deep Research is retired from the product surface; preserve historical rows
-- for account export and deletion, but stop indexing or linking them to the
-- removed planner route.
drop trigger if exists workspace_search_invalidation on public.deep_research_runs;

delete from public.workspace_search_index where source_table = 'deep_research_runs';

create or replace view public.workspace_search_sources with (security_invoker=true) as
select d.*, md5(d.title || E'\n' || d.body) as source_digest from (
  select 'projects'::text source_table, id source_id, owner_id, id project_id,
    'project'::text kind, left(name,200) title, left(coalesce(description,''),4000) body,
    '/projects/'||id::text href, updated_at from public.projects
  union all
  select 'project_chats', c.id, p.owner_id, c.project_id, 'project_chat', left(c.title,200),
    ''::text, '/projects/'||c.project_id::text||'/chat/'||c.id::text, c.updated_at
    from public.project_chats c join public.projects p on p.id=c.project_id
  union all
  select 'project_files', f.id, p.owner_id, f.project_id, 'file', left(f.name,200),
    left(coalesce(f.mime_type,''),4000), '/projects/'||f.project_id::text, f.created_at
    from public.project_files f join public.projects p on p.id=f.project_id where f.status='ready'
  union all
  select 'project_memory', m.id, p.owner_id, m.project_id, 'memory', left(m.content,80),
    left(m.content,4000), '/memory', m.created_at
    from public.project_memory m join public.projects p on p.id=m.project_id
  union all
  select 'user_library_items', id, user_id, null::uuid,
    case when item_type='image' then 'image' when item_type in ('document','code','website_draft','chat_artifact') then 'artifact' else 'file' end,
    left(title,200), left(coalesce(content_text,''),4000), '/library', updated_at
    from public.user_library_items
  union all
  select 'context_packs', id, user_id, null::uuid, 'context_pack', left(name,200),
    left(description,4000), '/context-packs', updated_at from public.context_packs
  union all
  select 'scheduled_tasks', id, user_id, null::uuid, 'automation', left(title,200),
    left(prompt,4000), '/scheduled-tasks', updated_at from public.scheduled_tasks
  union all
  select 'prompt_templates', id, user_id, project_id, 'prompt', left(name,200),
    left(body,4000), '/prompt-studio', updated_at from public.prompt_templates
  union all
  select 'goals', id, owner_id, project_id, 'goal', left(title,200),
    left(description,4000), '/goals', updated_at from public.goals
) d;

revoke all on public.workspace_search_sources from public, anon;
grant select on public.workspace_search_sources to authenticated, service_role;
