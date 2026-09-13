-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 13: durable owner-scoped goals and milestones.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'active'
    check (status in ('active','paused','completed','archived')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high')),
  progress integer not null default 0 check (progress between 0 and 100),
  target_date date,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  completed boolean not null default false,
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_owner_status_updated_idx
  on public.goals(owner_id, status, updated_at desc);

create index if not exists goals_owner_target_idx
  on public.goals(owner_id, target_date)
  where target_date is not null;

create index if not exists goal_milestones_owner_goal_idx
  on public.goal_milestones(owner_id, goal_id, position, created_at);

alter table public.goals enable row level security;
alter table public.goal_milestones enable row level security;

drop policy if exists "Owners manage goals" on public.goals;
create policy "Owners manage goals"
  on public.goals
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Owners manage goal milestones" on public.goal_milestones;
create policy "Owners manage goal milestones"
  on public.goal_milestones
  for all
  to authenticated
  using (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.goals g
      where g.id = goal_id
        and g.owner_id = auth.uid()
    )
  )
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.goals g
      where g.id = goal_id
        and g.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.goal_milestones to authenticated;
grant all on public.goals to service_role;
grant all on public.goal_milestones to service_role;
;
