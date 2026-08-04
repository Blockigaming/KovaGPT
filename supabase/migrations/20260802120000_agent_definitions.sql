create table if not exists public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  instructions text not null check (char_length(instructions) between 1 and 12000),
  allowed_tools text[] not null default '{}',
  memory_enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(allowed_tools) <= 20)
);

create table if not exists public.agent_definition_versions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.agent_definitions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  instructions text not null,
  allowed_tools text[] not null default '{}',
  memory_enabled boolean not null default false,
  source text not null check (source in ('create','edit','duplicate','restore')),
  created_at timestamptz not null default now(),
  unique(definition_id, version)
);

create index if not exists agent_definitions_owner_updated_idx on public.agent_definitions(owner_id, archived_at, updated_at desc);
create index if not exists agent_definition_versions_latest_idx on public.agent_definition_versions(definition_id, version desc);
alter table public.agent_definitions enable row level security;
alter table public.agent_definition_versions enable row level security;
create policy "Owners manage agent definitions" on public.agent_definitions for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Owners read agent versions" on public.agent_definition_versions for select to authenticated using (auth.uid() = owner_id);
create policy "Owners insert agent versions" on public.agent_definition_versions for insert to authenticated with check (auth.uid() = owner_id and exists(select 1 from public.agent_definitions d where d.id = definition_id and d.owner_id = auth.uid()));
create policy "Owners delete agent versions" on public.agent_definition_versions for delete to authenticated using (auth.uid() = owner_id);
revoke all on public.agent_definitions, public.agent_definition_versions from anon;
grant select,insert,update,delete on public.agent_definitions, public.agent_definition_versions to authenticated;
