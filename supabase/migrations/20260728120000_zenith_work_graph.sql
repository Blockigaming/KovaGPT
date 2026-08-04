-- Project Zenith: authoritative specialist tasks, dependency edges and durable graph layout.
create table public.agent_specialist_tasks (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.agent_jobs(id) on delete cascade, specialist_key text not null,
  role text not null, objective text not null, status text not null default 'waiting' check (status in ('waiting','ready','running','blocked','approval_required','retrying','completed','failed','cancelled')),
  attempt integer not null default 0, max_attempts integer not null default 3, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(run_id,id), unique(run_id,specialist_key)
);
create table public.agent_dependency_edges (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.agent_jobs(id) on delete cascade,
  source_task_id uuid not null, destination_task_id uuid not null,
  dependency_type text not null check (dependency_type in ('blocks','requires','approval','review','retry','handoff')),
  condition jsonb, display_metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  check(source_task_id<>destination_task_id),
  foreign key(run_id,source_task_id) references public.agent_specialist_tasks(run_id,id) on delete cascade,
  foreign key(run_id,destination_task_id) references public.agent_specialist_tasks(run_id,id) on delete cascade
);
create unique index agent_dependency_edges_active_unique on public.agent_dependency_edges(run_id,source_task_id,destination_task_id,dependency_type) where deleted_at is null;
create index agent_dependency_edges_run_idx on public.agent_dependency_edges(run_id) where deleted_at is null;
create table public.agent_graph_preferences (
  owner_id uuid not null references auth.users(id) on delete cascade, run_id uuid not null references public.agent_jobs(id) on delete cascade,
  layout_direction text not null default 'LR' check(layout_direction in ('LR','TB')), density text not null default 'comfortable' check(density in ('compact','comfortable')),
  node_positions jsonb not null default '{}', pinned_node_ids uuid[] not null default '{}', updated_at timestamptz not null default now(), primary key(owner_id,run_id)
);

create or replace function public.validate_agent_dependency_edge() returns trigger language plpgsql security definer set search_path=public as $$
declare run_owner uuid; cycle_found boolean;
begin
  select owner_id into run_owner from agent_jobs where id=new.run_id;
  if run_owner is null or new.owner_id<>run_owner then raise exception 'Edge owner must own run'; end if;
  if exists(select 1 from agent_specialist_tasks where id in(new.source_task_id,new.destination_task_id) and owner_id<>new.owner_id) then raise exception 'Task owner mismatch'; end if;
  with recursive reachable(id) as (
    select destination_task_id from agent_dependency_edges where run_id=new.run_id and source_task_id=new.destination_task_id and deleted_at is null
    union select edge.destination_task_id from agent_dependency_edges edge join reachable on edge.source_task_id=reachable.id where edge.run_id=new.run_id and edge.deleted_at is null
  ) select exists(select 1 from reachable where id=new.source_task_id) into cycle_found;
  if cycle_found then raise exception 'Dependency cycle rejected'; end if;
  return new;
end $$;
create trigger validate_agent_dependency_edge before insert or update of source_task_id,destination_task_id,run_id,owner_id,deleted_at on public.agent_dependency_edges for each row when(new.deleted_at is null) execute function public.validate_agent_dependency_edge();

alter table public.agent_specialist_tasks enable row level security;
alter table public.agent_dependency_edges enable row level security;
alter table public.agent_graph_preferences enable row level security;
create policy "Owners read specialist tasks" on public.agent_specialist_tasks for select using(auth.uid()=owner_id);
create policy "Owners read dependency edges" on public.agent_dependency_edges for select using(auth.uid()=owner_id);
create policy "Owners manage graph preferences" on public.agent_graph_preferences for all using(auth.uid()=owner_id) with check(auth.uid()=owner_id and exists(select 1 from agent_jobs j where j.id=run_id and j.owner_id=auth.uid()));

create or replace function public.ready_agent_specialist_tasks(p_run_id uuid) returns setof public.agent_specialist_tasks language sql security definer set search_path=public as $$
  select task.* from agent_specialist_tasks task where task.run_id=p_run_id and task.status in('waiting','ready','retrying') and not exists(
    select 1 from agent_dependency_edges edge join agent_specialist_tasks prerequisite on prerequisite.id=edge.source_task_id
    where edge.run_id=p_run_id and edge.destination_task_id=task.id and edge.deleted_at is null and prerequisite.status<>'completed'
  ) order by task.created_at;
$$;
revoke all on function public.ready_agent_specialist_tasks(uuid) from public,anon,authenticated;
grant execute on function public.ready_agent_specialist_tasks(uuid) to service_role;
