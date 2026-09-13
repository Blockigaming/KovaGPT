-- Day 15: canonical source-of-truth for the chat workspace tables.
-- Idempotent and non-destructive against production, where these tables already
-- exist with the canonical owner_id/instruction/active shape. This source-only
-- history entry must also replay over the reviewed production lineage.

-- Reconciliation guard: earlier drafts created development-only variants of these
-- tables keyed by user_id. Those variants are empty; production is unaffected
-- because production already has owner_id.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['chat_branches','chat_custom_rules','chat_message_versions','chat_pinned_files'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='owner_id') then
      execute format('select count(*) from public.%I', t) into n;
      if n = 0 then
        execute format('drop table public.%I cascade', t);
      else
        raise exception 'legacy % table holds rows and cannot be reconciled automatically', t;
      end if;
    end if;
  end loop;
end
$$;

-- Shared updated_at helper (trigger-only: not RPC-executable) ------------------
create or replace function public.kova_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.kova_set_updated_at() from public;
revoke all on function public.kova_set_updated_at() from anon;
revoke all on function public.kova_set_updated_at() from authenticated;

-- 1. chat_branches -------------------------------------------------------------
create table if not exists public.chat_branches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  parent_branch_id uuid references public.chat_branches(id) on delete cascade,
  branch_from_parent_message_id text,
  branch_from_message_id text,
  branch_from_message_index integer,
  message_ids text[] not null default '{}'::text[],
  label text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='chat_branches_chat_id_length' and conrelid='public.chat_branches'::regclass) then
    alter table public.chat_branches add constraint chat_branches_chat_id_length
      check (char_length(chat_id) between 1 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_branches_label_length' and conrelid='public.chat_branches'::regclass) then
    alter table public.chat_branches add constraint chat_branches_label_length
      check (label is null or char_length(label) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_branches_from_message_ids_length' and conrelid='public.chat_branches'::regclass) then
    alter table public.chat_branches add constraint chat_branches_from_message_ids_length
      check (
        (branch_from_parent_message_id is null or char_length(branch_from_parent_message_id) <= 256)
        and (branch_from_message_id is null or char_length(branch_from_message_id) <= 256)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_branches_from_message_index_range' and conrelid='public.chat_branches'::regclass) then
    alter table public.chat_branches add constraint chat_branches_from_message_index_range
      check (branch_from_message_index is null or branch_from_message_index >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_branches_not_self_parent' and conrelid='public.chat_branches'::regclass) then
    alter table public.chat_branches add constraint chat_branches_not_self_parent
      check (parent_branch_id is null or parent_branch_id <> id);
  end if;
end
$$;

create index if not exists idx_chat_branches_owner_chat on public.chat_branches (owner_id, chat_id, created_at);
create index if not exists idx_chat_branches_parent on public.chat_branches (parent_branch_id);
create unique index if not exists uq_chat_branches_active_per_chat
  on public.chat_branches (owner_id, chat_id) where active;

drop trigger if exists chat_branches_set_updated_at on public.chat_branches;
create trigger chat_branches_set_updated_at
  before update on public.chat_branches
  for each row execute function public.kova_set_updated_at();

create or replace function public.kova_chat_branch_lineage_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent public.chat_branches;
  v_cursor uuid;
  v_hops integer := 0;
begin
  if new.parent_branch_id is null then
    return new;
  end if;
  if new.parent_branch_id = new.id then
    raise exception 'chat branch cannot be its own parent';
  end if;

  select * into v_parent from public.chat_branches where id = new.parent_branch_id;
  if v_parent.id is null then
    raise exception 'parent branch does not exist';
  end if;
  if v_parent.owner_id <> new.owner_id then
    raise exception 'parent branch belongs to a different owner';
  end if;
  if v_parent.chat_id <> new.chat_id then
    raise exception 'parent branch belongs to a different chat';
  end if;

  v_cursor := v_parent.parent_branch_id;
  while v_cursor is not null loop
    v_hops := v_hops + 1;
    if v_cursor = new.id then
      raise exception 'chat branch lineage cycle detected';
    end if;
    if v_hops > 64 then
      raise exception 'chat branch lineage too deep';
    end if;
    select parent_branch_id into v_cursor from public.chat_branches where id = v_cursor;
  end loop;

  return new;
end;
$$;

revoke all on function public.kova_chat_branch_lineage_guard() from public;
revoke all on function public.kova_chat_branch_lineage_guard() from anon;
revoke all on function public.kova_chat_branch_lineage_guard() from authenticated;

drop trigger if exists chat_branches_lineage_guard on public.chat_branches;
create trigger chat_branches_lineage_guard
  before insert or update of parent_branch_id, owner_id, chat_id on public.chat_branches
  for each row execute function public.kova_chat_branch_lineage_guard();

grant select, insert, update, delete on public.chat_branches to authenticated;
grant select, insert, update, delete on public.chat_branches to service_role;
revoke all on public.chat_branches from anon;

alter table public.chat_branches enable row level security;

drop policy if exists "chat_branches_owner_select" on public.chat_branches;
create policy "chat_branches_owner_select" on public.chat_branches
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "chat_branches_owner_insert" on public.chat_branches;
create policy "chat_branches_owner_insert" on public.chat_branches
  for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_branches_owner_update" on public.chat_branches;
create policy "chat_branches_owner_update" on public.chat_branches
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_branches_owner_delete" on public.chat_branches;
create policy "chat_branches_owner_delete" on public.chat_branches
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 2. chat_custom_rules ---------------------------------------------------------
create table if not exists public.chat_custom_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  instructions text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='chat_custom_rules_owner_chat_unique' and conrelid='public.chat_custom_rules'::regclass) then
    alter table public.chat_custom_rules add constraint chat_custom_rules_owner_chat_unique unique (owner_id, chat_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_custom_rules_chat_id_length' and conrelid='public.chat_custom_rules'::regclass) then
    alter table public.chat_custom_rules add constraint chat_custom_rules_chat_id_length
      check (char_length(chat_id) between 1 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_custom_rules_instructions_length' and conrelid='public.chat_custom_rules'::regclass) then
    alter table public.chat_custom_rules add constraint chat_custom_rules_instructions_length
      check (char_length(instructions) <= 8000);
  end if;
end
$$;

create index if not exists idx_chat_custom_rules_owner_chat on public.chat_custom_rules (owner_id, chat_id);

drop trigger if exists chat_custom_rules_set_updated_at on public.chat_custom_rules;
create trigger chat_custom_rules_set_updated_at
  before update on public.chat_custom_rules
  for each row execute function public.kova_set_updated_at();

grant select, insert, update, delete on public.chat_custom_rules to authenticated;
grant select, insert, update, delete on public.chat_custom_rules to service_role;
revoke all on public.chat_custom_rules from anon;

alter table public.chat_custom_rules enable row level security;

drop policy if exists "chat_custom_rules_owner_select" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_select" on public.chat_custom_rules
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "chat_custom_rules_owner_insert" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_insert" on public.chat_custom_rules
  for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_custom_rules_owner_update" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_update" on public.chat_custom_rules
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_custom_rules_owner_delete" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_delete" on public.chat_custom_rules
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 3. chat_message_versions -----------------------------------------------------
create table if not exists public.chat_message_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  message_id text not null,
  branch_id uuid references public.chat_branches(id) on delete set null,
  version integer not null,
  source text not null,
  edit_instruction text,
  content text not null,
  original_content text,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='chat_message_versions_version_positive' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_version_positive check (version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_message_versions_source_allowed' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_source_allowed
      check (source in ('original','inline_edit','branch_edit','regeneration','retry'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_message_versions_ids_length' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_ids_length
      check (char_length(chat_id) between 1 and 256 and char_length(message_id) between 1 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_message_versions_content_length' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_content_length
      check (char_length(content) <= 131072 and (original_content is null or char_length(original_content) <= 131072));
  end if;
  -- Production already uses instruction; do not require or create the retired
  -- development-only column solely to validate a compatibility constraint.
  if exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='chat_message_versions' and column_name='edit_instruction')
    and not exists (select 1 from pg_constraint where conname='chat_message_versions_edit_instruction_length' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_edit_instruction_length
      check (edit_instruction is null or char_length(edit_instruction) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_message_versions_unique_version' and conrelid='public.chat_message_versions'::regclass) then
    alter table public.chat_message_versions add constraint chat_message_versions_unique_version
      unique (owner_id, chat_id, message_id, version);
  end if;
end
$$;

create index if not exists idx_chat_message_versions_lookup
  on public.chat_message_versions (owner_id, chat_id, message_id, version desc);
create index if not exists idx_chat_message_versions_branch on public.chat_message_versions (branch_id);
create unique index if not exists uq_chat_message_versions_accepted
  on public.chat_message_versions (owner_id, chat_id, message_id) where accepted;

grant select, insert, update, delete on public.chat_message_versions to authenticated;
grant select, insert, update, delete on public.chat_message_versions to service_role;
revoke all on public.chat_message_versions from anon;

alter table public.chat_message_versions enable row level security;

drop policy if exists "chat_message_versions_owner_select" on public.chat_message_versions;
create policy "chat_message_versions_owner_select" on public.chat_message_versions
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "chat_message_versions_owner_insert" on public.chat_message_versions;
create policy "chat_message_versions_owner_insert" on public.chat_message_versions
  for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_message_versions_owner_update" on public.chat_message_versions;
create policy "chat_message_versions_owner_update" on public.chat_message_versions
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "chat_message_versions_owner_delete" on public.chat_message_versions;
create policy "chat_message_versions_owner_delete" on public.chat_message_versions
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 4. chat_pinned_files ---------------------------------------------------------
create table if not exists public.chat_pinned_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  source_type text not null,
  source_id uuid not null,
  project_id uuid references public.projects(id) on delete cascade,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='chat_pinned_files_chat_id_length' and conrelid='public.chat_pinned_files'::regclass) then
    alter table public.chat_pinned_files add constraint chat_pinned_files_chat_id_length
      check (char_length(chat_id) between 1 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_pinned_files_source_type_allowed' and conrelid='public.chat_pinned_files'::regclass) then
    alter table public.chat_pinned_files add constraint chat_pinned_files_source_type_allowed
      check (source_type in ('library','project_file'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_pinned_files_status_allowed' and conrelid='public.chat_pinned_files'::regclass) then
    alter table public.chat_pinned_files add constraint chat_pinned_files_status_allowed
      check (status in ('ready','active','indexing','failed','deleted','permission_lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_pinned_files_source_project_coherence' and conrelid='public.chat_pinned_files'::regclass) then
    alter table public.chat_pinned_files add constraint chat_pinned_files_source_project_coherence
      check (
        (source_type = 'library' and project_id is null)
        or (source_type = 'project_file' and project_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='chat_pinned_files_unique_source' and conrelid='public.chat_pinned_files'::regclass) then
    alter table public.chat_pinned_files add constraint chat_pinned_files_unique_source
      unique (owner_id, chat_id, source_type, source_id);
  end if;
end
$$;

create index if not exists idx_chat_pinned_files_owner_chat on public.chat_pinned_files (owner_id, chat_id, created_at);
create index if not exists idx_chat_pinned_files_source on public.chat_pinned_files (source_type, source_id);
create index if not exists idx_chat_pinned_files_project on public.chat_pinned_files (project_id);

drop trigger if exists chat_pinned_files_set_updated_at on public.chat_pinned_files;
create trigger chat_pinned_files_set_updated_at
  before update on public.chat_pinned_files
  for each row execute function public.kova_set_updated_at();

create or replace function public.kova_can_pin_source(p_source_type text, p_source_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_source_type = 'library' then exists (
      select 1 from public.user_library_items li
      where li.id = p_source_id and li.user_id = (select auth.uid())
    )
    when p_source_type = 'project_file' then p_project_id is not null and exists (
      select 1 from public.project_files pf
      where pf.id = p_source_id and pf.project_id = p_project_id
    )
    else false
  end;
$$;

revoke all on function public.kova_can_pin_source(text, uuid, uuid) from public;
revoke all on function public.kova_can_pin_source(text, uuid, uuid) from anon;
grant execute on function public.kova_can_pin_source(text, uuid, uuid) to authenticated;
grant execute on function public.kova_can_pin_source(text, uuid, uuid) to service_role;

grant select, insert, update, delete on public.chat_pinned_files to authenticated;
grant select, insert, update, delete on public.chat_pinned_files to service_role;
revoke all on public.chat_pinned_files from anon;

alter table public.chat_pinned_files enable row level security;

drop policy if exists "chat_pinned_files_owner_select" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_select" on public.chat_pinned_files
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "chat_pinned_files_owner_insert" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_insert" on public.chat_pinned_files
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and public.kova_can_pin_source(source_type, source_id, project_id));
drop policy if exists "chat_pinned_files_owner_update" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_update" on public.chat_pinned_files
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and public.kova_can_pin_source(source_type, source_id, project_id));
drop policy if exists "chat_pinned_files_owner_delete" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_delete" on public.chat_pinned_files
  for delete to authenticated using ((select auth.uid()) = owner_id);

drop function if exists public.kova_can_use_project_file(uuid);