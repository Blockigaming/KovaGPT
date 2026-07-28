-- Project Apollo: durable dependency graphs and specialist-agent outputs.
create table if not exists public.agent_run_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_task_id uuid references public.agent_run_tasks(id) on delete set null,
  client_key text not null,
  agent_role text not null check (agent_role in ('planner','research','browser','file','coding','writing','review')),
  title text not null,
  instructions text not null,
  dependencies text[] not null default '{}',
  reusable_subplan text,
  checkpoint boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting','queued','leased','running','approval_needed','retry_wait','failed','completed','cancelled','blocked')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  progress integer not null default 0 check (progress between 0 and 100),
  output_text text,
  output_metadata jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id, client_key)
);
alter table public.agent_run_tasks enable row level security;
create policy "agent task owner read" on public.agent_run_tasks for select using (auth.uid() = owner_id);
create index if not exists agent_tasks_ready on public.agent_run_tasks(status, available_at);
create index if not exists agent_tasks_run on public.agent_run_tasks(run_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-evidence', 'agent-evidence', false, 5242880, array['image/png'])
on conflict (id) do nothing;
create policy "agent evidence owner read" on storage.objects for select to authenticated
using (bucket_id = 'agent-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
