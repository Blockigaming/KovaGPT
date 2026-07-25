-- Durable Deep Research runs and evidence.
-- Additive and rollback-safe: creates new user-owned tables without mutating existing data.

create table if not exists public.deep_research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text,
  project_id uuid references public.projects(id) on delete set null,
  query text not null,
  status text not null default 'running' check (status in ('created', 'planning', 'searching', 'reading', 'comparing', 'analyzing', 'writing_report', 'running', 'complete', 'failed', 'canceled', 'cancelled')),
  plan jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  report text,
  error text,
  partial_failures jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deep_research_runs_user_created_idx on public.deep_research_runs(user_id, created_at desc);
create index if not exists deep_research_runs_project_idx on public.deep_research_runs(project_id, created_at desc) where project_id is not null;
create index if not exists deep_research_runs_chat_idx on public.deep_research_runs(user_id, chat_id) where chat_id is not null;

create table if not exists public.deep_research_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deep_research_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  query text not null,
  title text not null,
  url text not null,
  domain text not null,
  snippet text,
  source_state text not null default 'discovered' check (source_state in ('discovered', 'opened', 'read', 'used', 'rejected', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists deep_research_evidence_run_idx on public.deep_research_evidence(run_id, created_at);
create index if not exists deep_research_evidence_user_idx on public.deep_research_evidence(user_id, created_at desc);

alter table public.deep_research_runs enable row level security;
alter table public.deep_research_evidence enable row level security;

create policy "deep_research_runs_select_own"
  on public.deep_research_runs for select to authenticated
  using (auth.uid() = user_id);

create policy "deep_research_runs_insert_own"
  on public.deep_research_runs for insert to authenticated
  with check (auth.uid() = user_id);

create policy "deep_research_runs_update_own"
  on public.deep_research_runs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "deep_research_runs_delete_own"
  on public.deep_research_runs for delete to authenticated
  using (auth.uid() = user_id);

create policy "deep_research_evidence_select_own"
  on public.deep_research_evidence for select to authenticated
  using (auth.uid() = user_id);

create policy "deep_research_evidence_insert_own"
  on public.deep_research_evidence for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.deep_research_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );

create policy "deep_research_evidence_update_own"
  on public.deep_research_evidence for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "deep_research_evidence_delete_own"
  on public.deep_research_evidence for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_deep_research_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deep_research_runs_updated_at on public.deep_research_runs;
create trigger deep_research_runs_updated_at
before update on public.deep_research_runs
for each row execute function public.set_deep_research_updated_at();
