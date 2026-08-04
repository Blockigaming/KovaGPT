alter table public.agent_runs add column if not exists prior_run_id uuid references public.agent_runs(id) on delete set null;
alter table public.agent_runs add column if not exists cancellation_category text check(cancellation_category is null or cancellation_category in('user_requested','approval_denied','account_restricted','system_shutdown'));
create index if not exists agent_runs_prior_run_idx on public.agent_runs(owner_id,prior_run_id) where prior_run_id is not null;
