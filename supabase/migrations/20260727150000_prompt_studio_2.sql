-- Prompt Studio 2.0: owner-scoped folders, immutable revisions and explicit evaluations.
alter table public.prompt_templates add column if not exists folder text not null default 'Unfiled';
alter table public.prompt_templates add column if not exists use_count integer not null default 0 check (use_count >= 0);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(), prompt_id uuid not null references public.prompt_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, version integer not null,
  name text not null, body text not null, variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), unique(prompt_id, version)
);
alter table public.prompt_versions enable row level security;
create policy "prompt_versions_own" on public.prompt_versions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create index if not exists prompt_versions_prompt_created_idx on public.prompt_versions(prompt_id, created_at desc);

create table if not exists public.prompt_evaluations (
  id uuid primary key default gen_random_uuid(), prompt_id uuid not null references public.prompt_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5), notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.prompt_evaluations enable row level security;
create policy "prompt_evaluations_own" on public.prompt_evaluations for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create index if not exists prompt_evaluations_prompt_created_idx on public.prompt_evaluations(prompt_id, created_at desc);
