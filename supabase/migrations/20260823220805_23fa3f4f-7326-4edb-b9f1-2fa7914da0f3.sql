-- Day 15: atomic, owner-forced RPCs for the chat workspace.

create or replace function public.kova_record_message_version(
  p_chat_id text,
  p_message_id text,
  p_source text,
  p_content text,
  p_branch_id uuid default null,
  p_edit_instruction text default null,
  p_original_content text default null,
  p_accepted boolean default true,
  p_max_versions integer default 50
)
returns public.chat_message_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select auth.uid());
  v_next integer;
  v_row public.chat_message_versions;
  v_keep integer := greatest(coalesce(p_max_versions, 50), 1);
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || p_chat_id || ':' || p_message_id, 0)
  );

  if p_branch_id is not null and not exists (
    select 1 from public.chat_branches b
    where b.id = p_branch_id and b.owner_id = v_owner and b.chat_id = p_chat_id
  ) then
    raise exception 'branch_not_found';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.chat_message_versions
  where owner_id = v_owner and chat_id = p_chat_id and message_id = p_message_id;

  if coalesce(p_accepted, true) then
    update public.chat_message_versions
       set accepted = false
     where owner_id = v_owner
       and chat_id = p_chat_id
       and message_id = p_message_id
       and accepted;
  end if;

  insert into public.chat_message_versions (
    owner_id, chat_id, message_id, branch_id, version, source,
    edit_instruction, content, original_content, accepted
  ) values (
    v_owner, p_chat_id, p_message_id, p_branch_id, v_next, p_source,
    p_edit_instruction, p_content, p_original_content, coalesce(p_accepted, true)
  )
  returning * into v_row;

  delete from public.chat_message_versions t
   where t.owner_id = v_owner
     and t.chat_id = p_chat_id
     and t.message_id = p_message_id
     and not t.accepted
     and t.id <> v_row.id
     and t.version <= v_next - v_keep;

  return v_row;
end;
$$;

revoke all on function public.kova_record_message_version(text, text, text, text, uuid, text, text, boolean, integer) from public;
revoke all on function public.kova_record_message_version(text, text, text, text, uuid, text, text, boolean, integer) from anon;
grant execute on function public.kova_record_message_version(text, text, text, text, uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.kova_record_message_version(text, text, text, text, uuid, text, text, boolean, integer) to service_role;

create or replace function public.kova_accept_message_version(p_version_id uuid)
returns public.chat_message_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select auth.uid());
  v_row public.chat_message_versions;
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row from public.chat_message_versions
   where id = p_version_id and owner_id = v_owner
   for update;
  if v_row.id is null then
    raise exception 'version_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || v_row.chat_id || ':' || v_row.message_id, 0)
  );

  update public.chat_message_versions
     set accepted = false
   where owner_id = v_owner
     and chat_id = v_row.chat_id
     and message_id = v_row.message_id
     and accepted
     and id <> v_row.id;

  update public.chat_message_versions
     set accepted = true
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.kova_accept_message_version(uuid) from public;
revoke all on function public.kova_accept_message_version(uuid) from anon;
grant execute on function public.kova_accept_message_version(uuid) to authenticated;
grant execute on function public.kova_accept_message_version(uuid) to service_role;

create or replace function public.kova_create_chat_branch(
  p_chat_id text,
  p_parent_branch_id uuid default null,
  p_branch_from_parent_message_id text default null,
  p_branch_from_message_id text default null,
  p_branch_from_message_index integer default null,
  p_message_ids text[] default '{}'::text[],
  p_label text default null,
  p_activate boolean default true,
  p_max_branches integer default 40
)
returns public.chat_branches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
  v_row public.chat_branches;
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_chat_id, 0));

  select count(*) into v_count from public.chat_branches
   where owner_id = v_owner and chat_id = p_chat_id;
  if v_count >= greatest(coalesce(p_max_branches, 40), 1) then
    raise exception 'branch_limit_reached';
  end if;

  if p_parent_branch_id is not null and not exists (
    select 1 from public.chat_branches b
    where b.id = p_parent_branch_id and b.owner_id = v_owner and b.chat_id = p_chat_id
  ) then
    raise exception 'parent_branch_not_found';
  end if;

  if coalesce(p_activate, true) then
    update public.chat_branches
       set active = false
     where owner_id = v_owner and chat_id = p_chat_id and active;
  end if;

  insert into public.chat_branches (
    owner_id, chat_id, parent_branch_id, branch_from_parent_message_id,
    branch_from_message_id, branch_from_message_index, message_ids, label, active
  ) values (
    v_owner, p_chat_id, p_parent_branch_id, p_branch_from_parent_message_id,
    p_branch_from_message_id, p_branch_from_message_index,
    coalesce(p_message_ids, '{}'::text[]), p_label, coalesce(p_activate, true)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.kova_create_chat_branch(text, uuid, text, text, integer, text[], text, boolean, integer) from public;
revoke all on function public.kova_create_chat_branch(text, uuid, text, text, integer, text[], text, boolean, integer) from anon;
grant execute on function public.kova_create_chat_branch(text, uuid, text, text, integer, text[], text, boolean, integer) to authenticated;
grant execute on function public.kova_create_chat_branch(text, uuid, text, text, integer, text[], text, boolean, integer) to service_role;

create or replace function public.kova_activate_chat_branch(p_chat_id text, p_branch_id uuid)
returns public.chat_branches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select auth.uid());
  v_row public.chat_branches;
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_chat_id, 0));

  select * into v_row from public.chat_branches
   where id = p_branch_id and owner_id = v_owner and chat_id = p_chat_id
   for update;
  if v_row.id is null then
    raise exception 'branch_not_found';
  end if;

  update public.chat_branches
     set active = false
   where owner_id = v_owner and chat_id = p_chat_id and active and id <> v_row.id;

  update public.chat_branches
     set active = true
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.kova_activate_chat_branch(text, uuid) from public;
revoke all on function public.kova_activate_chat_branch(text, uuid) from anon;
grant execute on function public.kova_activate_chat_branch(text, uuid) to authenticated;
grant execute on function public.kova_activate_chat_branch(text, uuid) to service_role;

create or replace function public.kova_update_chat_branch_messages(
  p_branch_id uuid,
  p_message_ids text[],
  p_label text default null
)
returns public.chat_branches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := (select auth.uid());
  v_row public.chat_branches;
begin
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  update public.chat_branches
     set message_ids = coalesce(p_message_ids, '{}'::text[]),
         label = coalesce(p_label, label)
   where id = p_branch_id and owner_id = v_owner
  returning * into v_row;

  if v_row.id is null then
    raise exception 'branch_not_found';
  end if;
  return v_row;
end;
$$;

revoke all on function public.kova_update_chat_branch_messages(uuid, text[], text) from public;
revoke all on function public.kova_update_chat_branch_messages(uuid, text[], text) from anon;
grant execute on function public.kova_update_chat_branch_messages(uuid, text[], text) to authenticated;
grant execute on function public.kova_update_chat_branch_messages(uuid, text[], text) to service_role;