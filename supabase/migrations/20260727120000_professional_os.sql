-- Professional workspace additions. All records remain owner/member scoped.
create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade, body text not null check (char_length(body) between 1 and 4000),
  anchor text, mentions jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists project_comments_project_created_idx on public.project_comments(project_id, created_at desc);
alter table public.project_comments enable row level security;
create policy "members view comments" on public.project_comments for select to authenticated using (public.is_project_member(project_id, auth.uid()));
create policy "members create comments" on public.project_comments for insert to authenticated with check (public.is_project_member(project_id, auth.uid()) and author_id = auth.uid());
create policy "authors update comments" on public.project_comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors delete comments" on public.project_comments for delete to authenticated using (author_id = auth.uid() or exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()));

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120), category text not null default 'General', body text not null check (char_length(body) between 1 and 12000),
  variables jsonb not null default '[]'::jsonb, project_id uuid references public.projects(id) on delete set null,
  context_pack_id uuid references public.context_packs(id) on delete set null, favorite boolean not null default false,
  last_used_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.prompt_templates enable row level security;
create policy "prompt_templates_own" on public.prompt_templates for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create index if not exists prompt_templates_user_updated_idx on public.prompt_templates(user_id, updated_at desc);

create table if not exists public.research_templates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120), steps jsonb not null default '[]'::jsonb,
  allowed_sites jsonb not null default '[]'::jsonb, source_preference text not null default 'balanced',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.research_templates enable row level security;
create policy "research_templates_own" on public.research_templates for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
