-- Day 15 reconciliation: advance the verified production chat-workspace schema.
--
-- Every statement is idempotent and additive. The four tables are empty in
-- production, but this file is still safe to re-run:
--   * chat_branches gains a durable conversation mapping (conversation_id),
--     branch_from_message_index and message_ids.
--   * chat_message_versions standardises on `instruction` (the production
--     column name) plus selection_start/selection_end, and the allowed
--     `source` values become exactly original | inline_edit | retry | branch_edit.
--   * chat_pinned_files standardises the usable status on `active`.
--   * chat id bounds are widened to 256 characters everywhere.
--   * the five kova_* RPCs are recreated to match, owner-forced, with fixed
--     search_path and EXECUTE revoked from PUBLIC/anon.

/* ------------------------------------------------------------------ *
 * chat_branches: durable conversation mapping
 * ------------------------------------------------------------------ */

alter table public.chat_branches add column if not exists conversation_id text;
alter table public.chat_branches add column if not exists branch_from_message_index integer;
alter table public.chat_branches
  add column if not exists message_ids text[] not null default '{}'::text[];

update public.chat_branches set conversation_id = chat_id where conversation_id is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_branches'
       and column_name = 'conversation_id' and is_nullable = 'YES'
  ) then
    alter table public.chat_branches alter column conversation_id set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_branches_conversation_id_length'
       and conrelid = 'public.chat_branches'::regclass
  ) then
    alter table public.chat_branches add constraint chat_branches_conversation_id_length
      check (char_length(conversation_id) between 1 and 256);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_branches_from_message_index_valid'
       and conrelid = 'public.chat_branches'::regclass
  ) then
    alter table public.chat_branches add constraint chat_branches_from_message_index_valid
      check (branch_from_message_index is null or branch_from_message_index >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_branches_message_ids_bounded'
       and conrelid = 'public.chat_branches'::regclass
  ) then
    alter table public.chat_branches add constraint chat_branches_message_ids_bounded
      check (coalesce(array_length(message_ids, 1), 0) <= 2000);
  end if;
end $$;

create unique index if not exists uq_chat_branches_conversation
  on public.chat_branches (owner_id, chat_id, conversation_id);
create index if not exists idx_chat_branches_owner_chat_active
  on public.chat_branches (owner_id, chat_id, active);

/* ------------------------------------------------------------------ *
 * chat_message_versions: `instruction` + selection range + sources
 * ------------------------------------------------------------------ */

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_message_versions'
       and column_name = 'edit_instruction'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_message_versions'
       and column_name = 'instruction'
  ) then
    alter table public.chat_message_versions rename column edit_instruction to instruction;
  end if;
end $$;

alter table public.chat_message_versions add column if not exists instruction text;
alter table public.chat_message_versions add column if not exists selection_start integer;
alter table public.chat_message_versions add column if not exists selection_end integer;

update public.chat_message_versions set source = 'retry' where source = 'regeneration';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'chat_message_versions_source_allowed'
       and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions drop constraint chat_message_versions_source_allowed;
  end if;
  alter table public.chat_message_versions add constraint chat_message_versions_source_allowed
    check (source in ('original', 'inline_edit', 'retry', 'branch_edit'));

  if exists (
    select 1 from pg_constraint
     where conname = 'chat_message_versions_edit_instruction_length'
       and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions
      drop constraint chat_message_versions_edit_instruction_length;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_message_versions_instruction_length'
       and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions add constraint chat_message_versions_instruction_length
      check (instruction is null or char_length(instruction) <= 4000);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_message_versions_selection_valid'
       and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions add constraint chat_message_versions_selection_valid
      check (
        (selection_start is null and selection_end is null)
        or (selection_start >= 0 and selection_end >= selection_start)
      );
  end if;
end $$;

/* ------------------------------------------------------------------ *
 * chat_pinned_files: `active` is the usable status
 * ------------------------------------------------------------------ */

update public.chat_pinned_files set status = 'active' where status = 'ready';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'chat_pinned_files_status_allowed'
       and conrelid = 'public.chat_pinned_files'::regclass
  ) then
    alter table public.chat_pinned_files drop constraint chat_pinned_files_status_allowed;
  end if;
  alter table public.chat_pinned_files add constraint chat_pinned_files_status_allowed
    check (status in ('active', 'indexing', 'failed', 'permission_lost', 'deleted'));
end $$;

alter table public.chat_pinned_files alter column status set default 'active';

/* ------------------------------------------------------------------ *
 * Widen chat id bounds to 256 across the workspace tables
 * ------------------------------------------------------------------ */

do $$
declare
  r record;
begin
  for r in
    select unnest(array[
      'chat_branches', 'chat_custom_rules', 'chat_message_versions', 'chat_pinned_files'
    ]) as tbl
  loop
    if exists (
      select 1 from pg_constraint
       where conname = format('%s_chat_id_length', r.tbl)
         and conrelid = format('public.%s', r.tbl)::regclass
    ) then
      execute format('alter table public.%I drop constraint %I', r.tbl, r.tbl || '_chat_id_length');
    end if;
    execute format(
      'alter table public.%I add constraint %I check (char_length(chat_id) between 1 and 256)',
      r.tbl, r.tbl || '_chat_id_length'
    );
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'chat_message_versions_ids_length'
       and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions drop constraint chat_message_versions_ids_length;
  end if;
  alter table public.chat_message_versions add constraint chat_message_versions_ids_length
    check (char_length(chat_id) between 1 and 256 and char_length(message_id) between 1 and 256);
end $$;

/* ------------------------------------------------------------------ *
 * Atomic, owner-forced RPCs
 * ------------------------------------------------------------------ */

drop function if exists public.kova_record_message_version(
  text, text, text, text, uuid, text, text, boolean, integer);

create or replace function public.kova_record_message_version(
  p_chat_id text,
  p_message_id text,
  p_source text,
  p_content text,
  p_branch_id uuid default null,
  p_instruction text default null,
  p_original_content text default null,
  p_selection_start integer default null,
  p_selection_end integer default null,
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
  if p_source not in ('original', 'inline_edit', 'retry', 'branch_edit') then
    raise exception 'invalid_source';
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
    instruction, content, original_content, selection_start, selection_end, accepted
  ) values (
    v_owner, p_chat_id, p_message_id, p_branch_id, v_next, p_source,
    p_instruction, p_content, p_original_content, p_selection_start, p_selection_end,
    coalesce(p_accepted, true)
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

revoke all on function public.kova_record_message_version(
  text, text, text, text, uuid, text, text, integer, integer, boolean, integer) from public;
revoke all on function public.kova_record_message_version(
  text, text, text, text, uuid, text, text, integer, integer, boolean, integer) from anon;
grant execute on function public.kova_record_message_version(
  text, text, text, text, uuid, text, text, integer, integer, boolean, integer) to authenticated;
grant execute on function public.kova_record_message_version(
  text, text, text, text, uuid, text, text, integer, integer, boolean, integer) to service_role;

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

drop function if exists public.kova_create_chat_branch(
  text, uuid, text, text, integer, text[], text, boolean, integer);

create or replace function public.kova_create_chat_branch(
  p_chat_id text,
  p_conversation_id text,
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
  if p_conversation_id is null or char_length(p_conversation_id) = 0 then
    raise exception 'conversation_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_chat_id, 0));

  select count(*) into v_count from public.chat_branches
   where owner_id = v_owner and chat_id = p_chat_id;
  if v_count >= greatest(coalesce(p_max_branches, 40), 1) then
    raise exception 'branch_limit_reached';
  end if;

  if exists (
    select 1 from public.chat_branches b
    where b.owner_id = v_owner and b.chat_id = p_chat_id
      and b.conversation_id = p_conversation_id
  ) then
    raise exception 'branch_conversation_exists';
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
    owner_id, chat_id, conversation_id, parent_branch_id, branch_from_parent_message_id,
    branch_from_message_id, branch_from_message_index, message_ids, label, active
  ) values (
    v_owner, p_chat_id, p_conversation_id, p_parent_branch_id, p_branch_from_parent_message_id,
    p_branch_from_message_id, p_branch_from_message_index,
    coalesce(p_message_ids, '{}'::text[]),
    nullif(left(coalesce(p_label, ''), 120), ''),
    coalesce(p_activate, true)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.kova_create_chat_branch(
  text, text, uuid, text, text, integer, text[], text, boolean, integer) from public;
revoke all on function public.kova_create_chat_branch(
  text, text, uuid, text, text, integer, text[], text, boolean, integer) from anon;
grant execute on function public.kova_create_chat_branch(
  text, text, uuid, text, text, integer, text[], text, boolean, integer) to authenticated;
grant execute on function public.kova_create_chat_branch(
  text, text, uuid, text, text, integer, text[], text, boolean, integer) to service_role;

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
  if coalesce(array_length(p_message_ids, 1), 0) > 2000 then
    raise exception 'too_many_messages';
  end if;

  update public.chat_branches
     set message_ids = coalesce(p_message_ids, '{}'::text[]),
         label = coalesce(nullif(left(coalesce(p_label, ''), 120), ''), label)
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
