alter table public.agent_runs
  add column if not exists agent_definition_id uuid references public.agent_definitions(id) on delete set null,
  add column if not exists agent_definition_version integer,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failure_category text,
  add column if not exists tool_call_count integer not null default 0 check(tool_call_count >= 0),
  add column if not exists tool_ids text[] not null default '{}',
  add column if not exists retry_count integer not null default 0 check(retry_count >= 0),
  add column if not exists provider_id text,
  add column if not exists model_id text;

alter table public.agent_runs add constraint agent_runs_definition_version_pair
  check ((agent_definition_id is null and agent_definition_version is null)
    or (agent_definition_id is not null and agent_definition_version is not null));
alter table public.agent_runs add constraint agent_runs_failure_category_bound
  check (failure_category is null or char_length(failure_category) <= 80);
alter table public.agent_runs add constraint agent_runs_tool_ids_bound check(cardinality(tool_ids) <= 20);
create index if not exists agent_runs_definition_time_idx
  on public.agent_runs(owner_id, agent_definition_id, created_at desc)
  where agent_definition_id is not null;
