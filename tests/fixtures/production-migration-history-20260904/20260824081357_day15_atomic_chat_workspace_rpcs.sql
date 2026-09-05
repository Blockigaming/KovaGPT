-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 15: atomic, owner-scoped chat workspace operations.
-- All RPCs are SECURITY INVOKER, use the caller's RLS context, fail closed,
-- have fixed search paths, and are not executable by anon/PUBLIC.

create or replace function public.create_chat_message_version(
  p_chat_id text,
  p_message_id text,
  p_content text,
  p_original_content text default null,
  p_instruction text default null,
  p_source text default 'inline_edit',
  p_branch_id uuid default null,
  p_accept boolean default false
)
returns public.chat_message_versions
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_next integer;
  v_row public.chat_message_versions%rowtype;
  v_retry boolean := false;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null
     or nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_content), '') is null then
    raise exception 'chat_message_version_input_required' using errcode = '22023';
  end if;

  if p_source not in ('original', 'inline_edit', 'retry', 'branch_edit') then
    raise exception 'invalid_chat_message_version_source' using errcode = '22023';
  end if;

  if p_branch_id is not null and not exists (
    select 1
    from public.chat_branches branch
    where branch.id = p_branch_id
      and branch.owner_id = v_owner
      and branch.chat_id = btrim(p_chat_id)
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'kova:chat-version:' || v_owner::text || ':' || btrim(p_chat_id) || ':' || btrim(p_message_id),
      0
    )
  );

  if p_accept then
    update public.chat_message_versions
    set accepted = false
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and message_id = btrim(p_message_id)
      and accepted;
  end if;

  <<insert_attempt>>
  loop
    select coalesce(max(version), 0) + 1
    into v_next
    from public.chat_message_versions
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and message_id = btrim(p_message_id);

    begin
      insert into public.chat_message_versions (
        owner_id,
        chat_id,
        message_id,
        branch_id,
        version,
        source,
        instruction,
        content,
        original_content,
        accepted
      ) values (
        v_owner,
        btrim(p_chat_id),
        btrim(p_message_id),
        p_branch_id,
        v_next,
        p_source,
        nullif(btrim(coalesce(p_instruction, '')), ''),
        p_content,
        p_original_content,
        p_accept
      )
      returning * into v_row;
      exit insert_attempt;
    exception
      when unique_violation then
        if v_retry then
          raise;
        end if;
        v_retry := true;
    end;
  end loop;

  -- Keep a bounded history while preserving the accepted version.
  delete from public.chat_message_versions old
  where old.owner_id = v_owner
    and old.chat_id = btrim(p_chat_id)
    and old.message_id = btrim(p_message_id)
    and not old.accepted
    and old.version <= greatest(v_row.version - 50, 0);

  return v_row;
end;
$$;

revoke all on function public.create_chat_message_version(text, text, text, text, text, text, uuid, boolean) from public;
revoke all on function public.create_chat_message_version(text, text, text, text, text, text, uuid, boolean) from anon;
grant execute on function public.create_chat_message_version(text, text, text, text, text, text, uuid, boolean) to authenticated, service_role;

create or replace function public.accept_chat_message_version(
  p_version_id uuid
)
returns public.chat_message_versions
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_target public.chat_message_versions%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select *
  into v_target
  from public.chat_message_versions
  where id = p_version_id
    and owner_id = v_owner
  for update;

  if not found then
    raise exception 'chat_message_version_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'kova:chat-version:' || v_owner::text || ':' || v_target.chat_id || ':' || v_target.message_id,
      0
    )
  );

  update public.chat_message_versions
  set accepted = false
  where owner_id = v_owner
    and chat_id = v_target.chat_id
    and message_id = v_target.message_id
    and accepted;

  update public.chat_message_versions
  set accepted = true
  where id = p_version_id
    and owner_id = v_owner
  returning * into v_target;

  if not found then
    raise exception 'chat_message_version_not_found' using errcode = 'P0002';
  end if;

  return v_target;
end;
$$;

revoke all on function public.accept_chat_message_version(uuid) from public;
revoke all on function public.accept_chat_message_version(uuid) from anon;
grant execute on function public.accept_chat_message_version(uuid) to authenticated, service_role;

create or replace function public.create_chat_branch(
  p_chat_id text,
  p_parent_branch_id uuid default null,
  p_branch_from_message_id text default null,
  p_branch_from_parent_message_id text default null,
  p_label text default null,
  p_activate boolean default true
)
returns public.chat_branches
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_count integer;
  v_row public.chat_branches%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kova:chat-branches:' || v_owner::text || ':' || btrim(p_chat_id), 0)
  );

  select count(*)::integer
  into v_count
  from public.chat_branches
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id);

  if v_count >= 40 then
    raise exception 'chat_branch_limit_reached' using errcode = '22023';
  end if;

  if p_activate then
    update public.chat_branches
    set active = false
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and active;
  end if;

  insert into public.chat_branches (
    owner_id,
    chat_id,
    parent_branch_id,
    branch_from_message_id,
    branch_from_parent_message_id,
    label,
    active
  ) values (
    v_owner,
    btrim(p_chat_id),
    p_parent_branch_id,
    nullif(btrim(coalesce(p_branch_from_message_id, '')), ''),
    nullif(btrim(coalesce(p_branch_from_parent_message_id, '')), ''),
    nullif(btrim(coalesce(p_label, '')), ''),
    p_activate
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_chat_branch(text, uuid, text, text, text, boolean) from public;
revoke all on function public.create_chat_branch(text, uuid, text, text, text, boolean) from anon;
grant execute on function public.create_chat_branch(text, uuid, text, text, text, boolean) to authenticated, service_role;

create or replace function public.activate_chat_branch(
  p_branch_id uuid
)
returns public.chat_branches
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_target public.chat_branches%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select *
  into v_target
  from public.chat_branches
  where id = p_branch_id
    and owner_id = v_owner
  for update;

  if not found then
    raise exception 'chat_branch_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kova:chat-branches:' || v_owner::text || ':' || v_target.chat_id, 0)
  );

  update public.chat_branches
  set active = false
  where owner_id = v_owner
    and chat_id = v_target.chat_id
    and active;

  update public.chat_branches
  set active = true
  where id = p_branch_id
    and owner_id = v_owner
  returning * into v_target;

  if not found then
    raise exception 'chat_branch_not_found' using errcode = 'P0002';
  end if;

  return v_target;
end;
$$;

revoke all on function public.activate_chat_branch(uuid) from public;
revoke all on function public.activate_chat_branch(uuid) from anon;
grant execute on function public.activate_chat_branch(uuid) to authenticated, service_role;

create or replace function public.save_chat_custom_rules(
  p_chat_id text,
  p_instructions text,
  p_enabled boolean default true
)
returns public.chat_custom_rules
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.chat_custom_rules%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  if char_length(coalesce(p_instructions, '')) > 8000 then
    raise exception 'chat_rules_too_long' using errcode = '22023';
  end if;

  insert into public.chat_custom_rules (
    owner_id,
    chat_id,
    instructions,
    enabled
  ) values (
    v_owner,
    btrim(p_chat_id),
    coalesce(p_instructions, ''),
    p_enabled
  )
  on conflict (owner_id, chat_id) do update
  set instructions = excluded.instructions,
      enabled = excluded.enabled,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_chat_custom_rules(text, text, boolean) from public;
revoke all on function public.save_chat_custom_rules(text, text, boolean) from anon;
grant execute on function public.save_chat_custom_rules(text, text, boolean) to authenticated, service_role;

create or replace function public.delete_chat_custom_rules(
  p_chat_id text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  delete from public.chat_custom_rules
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id);

  return found;
end;
$$;

revoke all on function public.delete_chat_custom_rules(text) from public;
revoke all on function public.delete_chat_custom_rules(text) from anon;
grant execute on function public.delete_chat_custom_rules(text) to authenticated, service_role;

create or replace function public.pin_chat_source(
  p_chat_id text,
  p_source_type text,
  p_source_id uuid,
  p_project_id uuid default null
)
returns public.chat_pinned_files
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_count integer;
  v_row public.chat_pinned_files%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null or p_source_id is null then
    raise exception 'pin_source_input_required' using errcode = '22023';
  end if;

  if p_source_type = 'library' then
    if p_project_id is not null or not exists (
      select 1
      from public.user_library_items item
      where item.id = p_source_id
        and item.user_id = v_owner
    ) then
      raise exception 'pin_source_not_authorized' using errcode = '42501';
    end if;
  elsif p_source_type = 'project_file' then
    if p_project_id is null or not exists (
      select 1
      from public.project_files file
      join public.projects project on project.id = file.project_id
      left join public.project_members member
        on member.project_id = project.id
       and member.user_id = v_owner
      where file.id = p_source_id
        and file.project_id = p_project_id
        and (project.owner_id = v_owner or member.user_id = v_owner)
    ) then
      raise exception 'pin_source_not_authorized' using errcode = '42501';
    end if;
  else
    raise exception 'invalid_pin_source_type' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kova:chat-pins:' || v_owner::text || ':' || btrim(p_chat_id), 0)
  );

  select *
  into v_row
  from public.chat_pinned_files
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id)
    and source_type = p_source_type
    and source_id = p_source_id
  for update;

  if found then
    update public.chat_pinned_files
    set project_id = p_project_id,
        status = 'active',
        updated_at = now()
    where id = v_row.id
      and owner_id = v_owner
    returning * into v_row;
    return v_row;
  end if;

  select count(*)::integer
  into v_count
  from public.chat_pinned_files
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id)
    and status <> 'deleted';

  if v_count >= 25 then
    raise exception 'chat_pin_limit_reached' using errcode = '22023';
  end if;

  insert into public.chat_pinned_files (
    owner_id,
    chat_id,
    source_type,
    source_id,
    project_id,
    status
  ) values (
    v_owner,
    btrim(p_chat_id),
    p_source_type,
    p_source_id,
    p_project_id,
    'active'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.pin_chat_source(text, text, uuid, uuid) from public;
revoke all on function public.pin_chat_source(text, text, uuid, uuid) from anon;
grant execute on function public.pin_chat_source(text, text, uuid, uuid) to authenticated, service_role;

create or replace function public.unpin_chat_source(
  p_pin_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  delete from public.chat_pinned_files
  where id = p_pin_id
    and owner_id = v_owner;

  return found;
end;
$$;

revoke all on function public.unpin_chat_source(uuid) from public;
revoke all on function public.unpin_chat_source(uuid) from anon;
grant execute on function public.unpin_chat_source(uuid) to authenticated, service_role;

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
      and pin.status <> 'deleted'
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
      end if;
    elsif v_pin.source_type = 'project_file' then
      select
        file.name,
        file.mime_type,
        left(coalesce((
          select string_agg(chunk.content, E'\n\n' order by chunk.chunk_index)
          from (
            select c.content, c.chunk_index
            from public.project_file_chunks c
            where c.file_id = file.id
              and c.project_id = file.project_id
            order by c.chunk_index
            limit 24
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
      elsif coalesce(v_content, '') = '' and v_status = 'active' then
        v_status := 'indexing';
      end if;
    end if;

    v_piece := left(coalesce(v_content, ''), v_take);
    if char_length(coalesce(v_content, '')) > v_take then
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
      'truncated', char_length(coalesce(v_content, '')) > v_take
    ));

    v_remaining := greatest(v_remaining - char_length(v_piece), 0);
  end loop;

  return jsonb_build_object(
    'chat_id', btrim(p_chat_id),
    'chat_rules', coalesce(v_chat_rules, ''),
    'project_instructions', coalesce(v_project_instructions, ''),
    'pinned_sources', v_pins,
    'max_chars', v_limit,
    'used_chars', v_limit - v_remaining,
    'truncated', v_any_truncated
  );
end;
$$;

revoke all on function public.get_chat_context_bundle(text, uuid, integer) from public;
revoke all on function public.get_chat_context_bundle(text, uuid, integer) from anon;
grant execute on function public.get_chat_context_bundle(text, uuid, integer) to authenticated, service_role;

comment on function public.create_chat_message_version(text, text, text, text, text, text, uuid, boolean)
  is 'Creates an owner-scoped, atomically numbered chat message version and optionally accepts it.';
comment on function public.activate_chat_branch(uuid)
  is 'Atomically activates one owner-scoped branch and fails if the target does not exist.';
comment on function public.get_chat_context_bundle(text, uuid, integer)
  is 'Returns bounded authorized chat rules, project instructions, and pinned-source context for server prompt assembly.';
;
