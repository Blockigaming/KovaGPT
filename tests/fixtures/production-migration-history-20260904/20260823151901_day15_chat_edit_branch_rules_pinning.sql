-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

begin;

create table if not exists public.chat_custom_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  instructions text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_custom_rules_chat_id_len check (char_length(chat_id) between 1 and 256),
  constraint chat_custom_rules_instructions_len check (char_length(instructions) <= 8000),
  unique(owner_id, chat_id)
);

create table if not exists public.chat_branches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  parent_branch_id uuid null references public.chat_branches(id) on delete cascade,
  branch_from_message_id text null,
  branch_from_parent_message_id text null,
  label text null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_branches_chat_id_len check (char_length(chat_id) between 1 and 256),
  constraint chat_branches_message_id_len check (branch_from_message_id is null or char_length(branch_from_message_id) <= 256),
  constraint chat_branches_label_len check (label is null or char_length(label) <= 120)
);

create unique index if not exists chat_branches_one_active_per_chat
  on public.chat_branches(owner_id, chat_id)
  where active;
create index if not exists chat_branches_owner_chat_idx
  on public.chat_branches(owner_id, chat_id, created_at desc);

create table if not exists public.chat_message_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  message_id text not null,
  branch_id uuid null references public.chat_branches(id) on delete set null,
  version integer not null,
  source text not null default 'inline_edit',
  instruction text null,
  content text not null,
  original_content text null,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chat_message_versions_chat_id_len check (char_length(chat_id) between 1 and 256),
  constraint chat_message_versions_message_id_len check (char_length(message_id) between 1 and 256),
  constraint chat_message_versions_version_positive check (version > 0),
  constraint chat_message_versions_source check (source in ('original','inline_edit','retry','branch_edit')),
  constraint chat_message_versions_instruction_len check (instruction is null or char_length(instruction) <= 4000),
  unique(owner_id, chat_id, message_id, version)
);
create index if not exists chat_message_versions_lookup_idx
  on public.chat_message_versions(owner_id, chat_id, message_id, version desc);

create table if not exists public.chat_pinned_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  source_type text not null,
  source_id uuid not null,
  project_id uuid null references public.projects(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_pinned_files_chat_id_len check (char_length(chat_id) between 1 and 256),
  constraint chat_pinned_files_source_type check (source_type in ('library','project_file')),
  constraint chat_pinned_files_status check (status in ('active','indexing','failed','permission_lost','deleted')),
  unique(owner_id, chat_id, source_type, source_id)
);
create index if not exists chat_pinned_files_owner_chat_idx
  on public.chat_pinned_files(owner_id, chat_id, created_at desc);

alter table public.chat_custom_rules enable row level security;
alter table public.chat_branches enable row level security;
alter table public.chat_message_versions enable row level security;
alter table public.chat_pinned_files enable row level security;

revoke all on public.chat_custom_rules from anon;
revoke all on public.chat_branches from anon;
revoke all on public.chat_message_versions from anon;
revoke all on public.chat_pinned_files from anon;

grant select, insert, update, delete on public.chat_custom_rules to authenticated;
grant select, insert, update, delete on public.chat_branches to authenticated;
grant select, insert, update, delete on public.chat_message_versions to authenticated;
grant select, insert, update, delete on public.chat_pinned_files to authenticated;

create policy chat_custom_rules_owner_select on public.chat_custom_rules for select to authenticated using (auth.uid() = owner_id);
create policy chat_custom_rules_owner_insert on public.chat_custom_rules for insert to authenticated with check (auth.uid() = owner_id);
create policy chat_custom_rules_owner_update on public.chat_custom_rules for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy chat_custom_rules_owner_delete on public.chat_custom_rules for delete to authenticated using (auth.uid() = owner_id);

create policy chat_branches_owner_select on public.chat_branches for select to authenticated using (auth.uid() = owner_id);
create policy chat_branches_owner_insert on public.chat_branches for insert to authenticated with check (auth.uid() = owner_id);
create policy chat_branches_owner_update on public.chat_branches for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy chat_branches_owner_delete on public.chat_branches for delete to authenticated using (auth.uid() = owner_id);

create policy chat_message_versions_owner_select on public.chat_message_versions for select to authenticated using (auth.uid() = owner_id);
create policy chat_message_versions_owner_insert on public.chat_message_versions for insert to authenticated with check (auth.uid() = owner_id);
create policy chat_message_versions_owner_update on public.chat_message_versions for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy chat_message_versions_owner_delete on public.chat_message_versions for delete to authenticated using (auth.uid() = owner_id);

create policy chat_pinned_files_owner_select on public.chat_pinned_files for select to authenticated using (auth.uid() = owner_id);
create policy chat_pinned_files_owner_insert on public.chat_pinned_files for insert to authenticated with check (
  auth.uid() = owner_id and (
    (source_type = 'library' and exists (select 1 from public.user_library_items u where u.id = source_id and u.user_id = auth.uid()))
    or
    (source_type = 'project_file' and exists (
      select 1 from public.project_files pf
      join public.projects p on p.id = pf.project_id
      left join public.project_members pm on pm.project_id = p.id and pm.user_id = auth.uid()
      where pf.id = source_id and (p.owner_id = auth.uid() or pm.user_id = auth.uid())
    ))
  )
);
create policy chat_pinned_files_owner_update on public.chat_pinned_files for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy chat_pinned_files_owner_delete on public.chat_pinned_files for delete to authenticated using (auth.uid() = owner_id);

commit;
;
