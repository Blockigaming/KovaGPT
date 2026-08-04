alter table public.agent_definition_versions
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.agent_definition_versions drop constraint if exists agent_definition_versions_source_check;
alter table public.agent_definition_versions
  add constraint agent_definition_versions_source_check
  check (source in ('create','edit','duplicate','import','restore'));

create or replace function public.update_agent_definition(
  p_id uuid, p_expected_version integer, p_name text, p_instructions text,
  p_project_id uuid, p_allowed_tools text[], p_memory_enabled boolean, p_source text default 'edit'
) returns public.agent_definitions
language plpgsql security invoker set search_path = public as $$
declare current_row public.agent_definitions; next_row public.agent_definitions;
begin
  if p_source not in ('edit','restore') then raise exception 'invalid_agent_version_source'; end if;
  select * into current_row from public.agent_definitions
    where id = p_id and owner_id = auth.uid() for update;
  if current_row.id is null then raise exception 'agent_not_found'; end if;
  if current_row.version <> p_expected_version then raise exception 'agent_version_conflict'; end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects where id=p_project_id and owner_id=auth.uid()
  ) then raise exception 'agent_project_not_authorized'; end if;
  if current_row.name = trim(p_name) and current_row.instructions = trim(p_instructions)
    and current_row.project_id is not distinct from p_project_id
    and current_row.allowed_tools = p_allowed_tools
    and current_row.memory_enabled = p_memory_enabled then return current_row; end if;
  update public.agent_definitions set name=trim(p_name), instructions=trim(p_instructions),
    project_id=p_project_id, allowed_tools=p_allowed_tools, memory_enabled=p_memory_enabled,
    version=version+1, updated_at=now()
    where id=p_id and owner_id=auth.uid() returning * into next_row;
  insert into public.agent_definition_versions
    (definition_id,owner_id,version,name,instructions,project_id,allowed_tools,memory_enabled,source)
  values(next_row.id,next_row.owner_id,next_row.version,next_row.name,next_row.instructions,
    next_row.project_id,next_row.allowed_tools,next_row.memory_enabled,p_source);
  delete from public.agent_definition_versions where definition_id=next_row.id and owner_id=auth.uid()
    and version not in (select version from public.agent_definition_versions
      where definition_id=next_row.id and owner_id=auth.uid() order by version desc limit 50);
  return next_row;
end $$;

revoke all on function public.update_agent_definition(uuid,integer,text,text,uuid,text[],boolean,text) from public, anon;
grant execute on function public.update_agent_definition(uuid,integer,text,text,uuid,text[],boolean,text) to authenticated;

create index if not exists agent_definition_versions_owner_time_idx
  on public.agent_definition_versions(owner_id, definition_id, version desc);
