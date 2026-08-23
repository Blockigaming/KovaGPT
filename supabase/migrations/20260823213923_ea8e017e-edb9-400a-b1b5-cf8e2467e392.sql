-- Day 15: canonical source alignment for the chat workspace tables.
--
-- These four tables already exist in production. This migration is written to be
-- idempotent and additive only: it creates what is missing, adds missing columns,
-- and re-asserts constraints, indexes, grants and owner-scoped RLS. It never
-- drops a column, table, or row.

-- Shared updated_at helper -----------------------------------------------------
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

-- 1. chat_branches -------------------------------------------------------------
create table if not exists public.chat_branches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  parent_message_id text,
  origin_message_id text,
  label text,
  is_active boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_branches
  add column if not exists user_id uuid,
  add column if not exists chat_id text,
  add column if not exists parent_message_id text,
  add column if not exists origin_message_id text,
  add column if not exists label text,
  add column if not exists is_active boolean not null default false,
  add column if not exists position integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_chat_branches_owner_chat
  on public.chat_branches (user_id, chat_id, position);

create index if not exists idx_chat_branches_active
  on public.chat_branches (user_id, chat_id)
  where is_active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_branches_label_length'
      and conrelid = 'public.chat_branches'::regclass
  ) then
    alter table public.chat_branches
      add constraint chat_branches_label_length
      check (label is null or char_length(label) <= 120);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_branches_chat_id_length'
      and conrelid = 'public.chat_branches'::regclass
  ) then
    alter table public.chat_branches
      add constraint chat_branches_chat_id_length
      check (char_length(chat_id) between 1 and 128);
  end if;
end
$$;

drop trigger if exists chat_branches_set_updated_at on public.chat_branches;
create trigger chat_branches_set_updated_at
  before update on public.chat_branches
  for each row execute function public.kova_set_updated_at();

grant select, insert, update, delete on public.chat_branches to authenticated;
grant all on public.chat_branches to service_role;
revoke all on public.chat_branches from anon;

alter table public.chat_branches enable row level security;

drop policy if exists "chat_branches_owner_select" on public.chat_branches;
create policy "chat_branches_owner_select" on public.chat_branches
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "chat_branches_owner_insert" on public.chat_branches;
create policy "chat_branches_owner_insert" on public.chat_branches
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "chat_branches_owner_update" on public.chat_branches;
create policy "chat_branches_owner_update" on public.chat_branches
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "chat_branches_owner_delete" on public.chat_branches;
create policy "chat_branches_owner_delete" on public.chat_branches
  for delete to authenticated using (auth.uid() = user_id);

-- 2. chat_message_versions -----------------------------------------------------
create table if not exists public.chat_message_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  message_id text not null,
  version integer not null default 1,
  content text not null,
  instruction text,
  selection_start integer,
  selection_end integer,
  created_at timestamptz not null default now()
);

alter table public.chat_message_versions
  add column if not exists user_id uuid,
  add column if not exists chat_id text,
  add column if not exists message_id text,
  add column if not exists version integer not null default 1,
  add column if not exists content text,
  add column if not exists instruction text,
  add column if not exists selection_start integer,
  add column if not exists selection_end integer,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_chat_message_versions_owner_message
  on public.chat_message_versions (user_id, chat_id, message_id, version desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_message_versions_content_length'
      and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_content_length
      check (char_length(content) <= 200000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_message_versions_instruction_length'
      and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_instruction_length
      check (instruction is null or char_length(instruction) <= 2000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_message_versions_selection_range'
      and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_selection_range
      check (
        (selection_start is null and selection_end is null)
        or (selection_start >= 0 and selection_end >= selection_start)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_message_versions_unique_version'
      and conrelid = 'public.chat_message_versions'::regclass
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_unique_version
      unique (user_id, chat_id, message_id, version);
  end if;
end
$$;

grant select, insert, delete on public.chat_message_versions to authenticated;
grant all on public.chat_message_versions to service_role;
revoke all on public.chat_message_versions from anon;

alter table public.chat_message_versions enable row level security;

drop policy if exists "chat_message_versions_owner_select" on public.chat_message_versions;
create policy "chat_message_versions_owner_select" on public.chat_message_versions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "chat_message_versions_owner_insert" on public.chat_message_versions;
create policy "chat_message_versions_owner_insert" on public.chat_message_versions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "chat_message_versions_owner_delete" on public.chat_message_versions;
create policy "chat_message_versions_owner_delete" on public.chat_message_versions
  for delete to authenticated using (auth.uid() = user_id);

-- 3. chat_custom_rules ---------------------------------------------------------
create table if not exists public.chat_custom_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  rules text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_custom_rules
  add column if not exists user_id uuid,
  add column if not exists chat_id text,
  add column if not exists rules text not null default '',
  add column if not exists enabled boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_custom_rules_owner_chat_unique'
      and conrelid = 'public.chat_custom_rules'::regclass
  ) then
    alter table public.chat_custom_rules
      add constraint chat_custom_rules_owner_chat_unique unique (user_id, chat_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_custom_rules_length'
      and conrelid = 'public.chat_custom_rules'::regclass
  ) then
    alter table public.chat_custom_rules
      add constraint chat_custom_rules_length check (char_length(rules) <= 4000);
  end if;
end
$$;

drop trigger if exists chat_custom_rules_set_updated_at on public.chat_custom_rules;
create trigger chat_custom_rules_set_updated_at
  before update on public.chat_custom_rules
  for each row execute function public.kova_set_updated_at();

grant select, insert, update, delete on public.chat_custom_rules to authenticated;
grant all on public.chat_custom_rules to service_role;
revoke all on public.chat_custom_rules from anon;

alter table public.chat_custom_rules enable row level security;

drop policy if exists "chat_custom_rules_owner_select" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_select" on public.chat_custom_rules
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "chat_custom_rules_owner_insert" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_insert" on public.chat_custom_rules
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "chat_custom_rules_owner_update" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_update" on public.chat_custom_rules
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "chat_custom_rules_owner_delete" on public.chat_custom_rules;
create policy "chat_custom_rules_owner_delete" on public.chat_custom_rules
  for delete to authenticated using (auth.uid() = user_id);

-- 4. chat_pinned_files ---------------------------------------------------------
create table if not exists public.chat_pinned_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  project_id uuid references public.projects(id) on delete cascade,
  file_id uuid references public.project_files(id) on delete cascade,
  file_name text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.chat_pinned_files
  add column if not exists user_id uuid,
  add column if not exists chat_id text,
  add column if not exists project_id uuid,
  add column if not exists file_id uuid,
  add column if not exists file_name text,
  add column if not exists position integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_pinned_files_owner_chat_file_unique'
      and conrelid = 'public.chat_pinned_files'::regclass
  ) then
    alter table public.chat_pinned_files
      add constraint chat_pinned_files_owner_chat_file_unique unique (user_id, chat_id, file_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_pinned_files_name_length'
      and conrelid = 'public.chat_pinned_files'::regclass
  ) then
    alter table public.chat_pinned_files
      add constraint chat_pinned_files_name_length
      check (file_name is null or char_length(file_name) <= 400);
  end if;
end
$$;

create index if not exists idx_chat_pinned_files_owner_chat
  on public.chat_pinned_files (user_id, chat_id, position);

create index if not exists idx_chat_pinned_files_file
  on public.chat_pinned_files (file_id);

grant select, insert, update, delete on public.chat_pinned_files to authenticated;
grant all on public.chat_pinned_files to service_role;
revoke all on public.chat_pinned_files from anon;

alter table public.chat_pinned_files enable row level security;

-- Project membership check reused by the pinned-file policies.
create or replace function public.kova_can_use_project_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_file_id is null or exists (
    select 1
    from public.project_files pf
    join public.project_members pm on pm.project_id = pf.project_id
    where pf.id = p_file_id
      and pm.user_id = auth.uid()
  );
$$;

revoke all on function public.kova_can_use_project_file(uuid) from public;
revoke all on function public.kova_can_use_project_file(uuid) from anon;
grant execute on function public.kova_can_use_project_file(uuid) to authenticated;
grant execute on function public.kova_can_use_project_file(uuid) to service_role;

drop policy if exists "chat_pinned_files_owner_select" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_select" on public.chat_pinned_files
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "chat_pinned_files_owner_insert" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_insert" on public.chat_pinned_files
  for insert to authenticated
  with check (auth.uid() = user_id and public.kova_can_use_project_file(file_id));

drop policy if exists "chat_pinned_files_owner_update" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_update" on public.chat_pinned_files
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.kova_can_use_project_file(file_id));

drop policy if exists "chat_pinned_files_owner_delete" on public.chat_pinned_files;
create policy "chat_pinned_files_owner_delete" on public.chat_pinned_files
  for delete to authenticated using (auth.uid() = user_id);

-- 5. Privileged-function lockdown ---------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'disconnect_github_account',
        'promote_agent_deliverable',
        'validate_agent_dependency_edge'
      )
  loop
    execute format('revoke all on function %s from anon', fn.sig);
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
    begin
      execute format('alter function %s set search_path = public', fn.sig);
    exception when others then
      null;
    end;
  end loop;
end
$$;