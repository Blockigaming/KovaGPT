-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 15: bounded workspace read model and stricter prompt-context inclusion.

create or replace function public.get_chat_context_bundle(
  p_chat_id text,
  p_project_id uuid default null,
  p_max_chars integer default 24000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_limit integer := greatest(1000, least(coalesce(p_max_chars, 24000), 48000));
  v_remaining integer;
  v_chat_rules text;
  v_project_instructions text;
  v_pins jsonb := '[]'::jsonb;
  v_pin record;
  v_title text;
  v_mime text;
  v_content text;
  v_piece text;
  v_take integer;
  v_status text;
  v_any_truncated boolean := false;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  select rules.instructions
  into v_chat_rules
  from public.chat_custom_rules rules
  where rules.owner_id = v_owner
    and rules.chat_id = btrim(p_chat_id)
    and rules.enabled
  limit 1;

  if p_project_id is not null then
    select project.system_prompt
    into v_project_instructions
    from public.projects project
    where project.id = p_project_id
      and (
        project.owner_id = v_owner
        or exists (
          select 1
          from public.project_members member
          where member.project_id = project.id
            and member.user_id = v_owner
        )
      )
    limit 1;
  end if;

  v_remaining := v_limit;

  for v_pin in
    select pin.*
    from public.chat_pinned_files pin
    where pin.owner_id = v_owner
      and pin.chat_id = btrim(p_chat_id)
      and pin.status in ('active', 'indexing')
    order by pin.created_at, pin.id
    limit 25
  loop
    if v_remaining <= 0 then
      v_any_truncated := true;
      exit;
    end if;

    v_title := null;
    v_mime := null;
    v_content := null;
    v_status := v_pin.status;
    v_take := least(v_remaining, 8000);

    if v_pin.source_type = 'library' then
      select
        coalesce(item.file_name, item.title),
        item.file_type,
        left(coalesce(item.content_text, ''), v_take + 1)
      into v_title, v_mime, v_content
      from public.user_library_items item
      where item.id = v_pin.source_id
        and item.user_id = v_owner;

      if not found then
        v_status := 'permission_lost';
        v_content := '';
      end if;
    elsif v_pin.source_type = 'project_file' then
      select
        file.name,
        file.mime_type,
        left(coalesce((
          select string_agg(chunk.content, E'\n\n' order by chunk.chunk_index)
          from (
            select left(c.content, 4000) as content, c.chunk_index
            from public.project_file_chunks c
            where c.file_id = file.id
              and c.project_id = file.project_id
            order by c.chunk_index
            limit 12
          ) chunk
        ), ''), v_take + 1)
      into v_title, v_mime, v_content
      from public.project_files file
      join public.projects project on project.id = file.project_id
      left join public.project_members member
        on member.project_id = project.id
       and member.user_id = v_owner
      where file.id = v_pin.source_id
        and file.project_id = v_pin.project_id
        and (project.owner_id = v_owner or member.user_id = v_owner)
      limit 1;

      if not found then
        v_status := 'permission_lost';
        v_content := '';
      elsif coalesce(v_content, '') = '' then
        v_status := 'indexing';
      end if;
    end if;

    -- Never inject inaccessible or not-yet-indexed content into the model.
    if v_status not in ('active') then
      v_piece := '';
    else
      v_piece := left(coalesce(v_content, ''), v_take);
    end if;

    if v_status = 'active' and char_length(coalesce(v_content, '')) > v_take then
      v_any_truncated := true;
    end if;

    v_pins := v_pins || jsonb_build_array(jsonb_build_object(
      'pin_id', v_pin.id,
      'source_type', v_pin.source_type,
      'source_id', v_pin.source_id,
      'project_id', v_pin.project_id,
      'title', v_title,
      'mime_type', v_mime,
      'status', v_status,
      'content', v_piece,
      'truncated', v_status = 'active' and char_length(coalesce(v_content, '')) > v_take
    ));

    v_remaining := greatest(v_remaining - char_length(v_piece), 0);
  end loop;

  return jsonb_build_object(
    'chat_id', btrim(p_chat_id),
    'instruction_precedence', jsonb_build_array('global', 'project', 'chat'),
    'chat_rules', coalesce(v_chat_rules, ''),
    'project_instructions', coalesce(v_project_instructions, ''),
    'pinned_sources', v_pins,
    'max_chars', v_limit,
    'used_chars', v_limit - v_remaining,
    'truncated', v_any_truncated
  );
end;
$$;

revoke all on function public.get_chat_context_bundle(text, uuid, integer) from public, anon;
grant execute on function public.get_chat_context_bundle(text, uuid, integer) to authenticated, service_role;

create or replace function public.get_chat_workspace_state(
  p_chat_id text,
  p_message_id text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_chat text := btrim(coalesce(p_chat_id, ''));
  v_message text := nullif(btrim(coalesce(p_message_id, '')), '');
  v_branches jsonb;
  v_rules jsonb;
  v_pins jsonb;
  v_versions jsonb;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if v_chat = '' then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', branch.id,
    'parent_branch_id', branch.parent_branch_id,
    'branch_from_message_id', branch.branch_from_message_id,
    'branch_from_parent_message_id', branch.branch_from_parent_message_id,
    'label', branch.label,
    'active', branch.active,
    'created_at', branch.created_at,
    'updated_at', branch.updated_at
  ) order by branch.created_at, branch.id), '[]'::jsonb)
  into v_branches
  from (
    select *
    from public.chat_branches
    where owner_id = v_owner
      and chat_id = v_chat
    order by created_at, id
    limit 40
  ) branch;

  select coalesce((
    select jsonb_build_object(
      'instructions', rules.instructions,
      'enabled', rules.enabled,
      'updated_at', rules.updated_at
    )
    from public.chat_custom_rules rules
    where rules.owner_id = v_owner
      and rules.chat_id = v_chat
    limit 1
  ), 'null'::jsonb)
  into v_rules;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pin.id,
    'source_type', pin.source_type,
    'source_id', pin.source_id,
    'project_id', pin.project_id,
    'stored_status', pin.status,
    'display_status', pin.display_status,
    'title', pin.title,
    'mime_type', pin.mime_type,
    'created_at', pin.created_at,
    'updated_at', pin.updated_at
  ) order by pin.created_at, pin.id), '[]'::jsonb)
  into v_pins
  from (
    select
      p.*,
      case
        when p.source_type = 'library' and item.id is null then 'permission_lost'
        when p.source_type = 'project_file' and file.id is null then 'permission_lost'
        when p.source_type = 'project_file' and not exists (
          select 1 from public.project_file_chunks chunk
          where chunk.file_id = p.source_id
            and chunk.project_id = p.project_id
        ) and p.status = 'active' then 'indexing'
        else p.status
      end as display_status,
      case
        when p.source_type = 'library' then coalesce(item.file_name, item.title)
        else file.name
      end as title,
      case
        when p.source_type = 'library' then item.file_type
        else file.mime_type
      end as mime_type
    from public.chat_pinned_files p
    left join public.user_library_items item
      on p.source_type = 'library'
     and item.id = p.source_id
     and item.user_id = v_owner
    left join public.project_files file
      on p.source_type = 'project_file'
     and file.id = p.source_id
     and file.project_id = p.project_id
     and exists (
       select 1
       from public.projects project
       left join public.project_members member
         on member.project_id = project.id
        and member.user_id = v_owner
       where project.id = file.project_id
         and (project.owner_id = v_owner or member.user_id = v_owner)
     )
    where p.owner_id = v_owner
      and p.chat_id = v_chat
      and p.status <> 'deleted'
    order by p.created_at, p.id
    limit 25
  ) pin;

  if v_message is null then
    v_versions := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', version.id,
      'branch_id', version.branch_id,
      'version', version.version,
      'source', version.source,
      'instruction', version.instruction,
      'content', version.content,
      'original_content', version.original_content,
      'accepted', version.accepted,
      'created_at', version.created_at
    ) order by version.version), '[]'::jsonb)
    into v_versions
    from (
      select *
      from public.chat_message_versions
      where owner_id = v_owner
        and chat_id = v_chat
        and message_id = v_message
      order by version desc
      limit 50
    ) version;
  end if;

  return jsonb_build_object(
    'schema_version', 'day15-v1',
    'chat_id', v_chat,
    'active_branch_id', (
      select branch.id
      from public.chat_branches branch
      where branch.owner_id = v_owner
        and branch.chat_id = v_chat
        and branch.active
      limit 1
    ),
    'branches', v_branches,
    'custom_rules', v_rules,
    'pinned_sources', v_pins,
    'message_id', v_message,
    'message_versions', v_versions
  );
end;
$$;

revoke all on function public.get_chat_workspace_state(text, text) from public, anon;
grant execute on function public.get_chat_workspace_state(text, text) to authenticated, service_role;

comment on function public.get_chat_workspace_state(text, text)
  is 'Returns a bounded owner-scoped read model for the Day 15 branch/rules/pins/version UI.';
;
