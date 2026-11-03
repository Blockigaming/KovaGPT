-- Forward-only subscription allowances for scheduled task *records*.
-- Free: 2 active tasks; Plus: 5 active tasks; Pro: no per-plan active-task
-- count ceiling. Other safety, runtime readiness, ownership, and rate limits
-- remain in force. This migration does not activate an unavailable worker.
do $$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='mutate_scheduled_task';
  if definition is null then
    raise exception 'scheduled_task_foundation_missing';
  end if;
  updated := replace(
    definition,
    'case tier when ''pro'' then 75 when ''plus'' then 5 when ''free'' then 1 else 0 end',
    'case tier when ''pro'' then 2147483647 when ''plus'' then 5 when ''free'' then 2 else 0 end'
  );
  if updated=definition then
    raise exception 'scheduled_task_plan_source_mismatch';
  end if;
  -- The existing task-total safety ceiling remains for Free and Plus, but
  -- cannot silently negate the unlimited Pro active-task allowance.
  updated := replace(
    updated,
    '(select count(*) from public.scheduled_tasks where user_id=p_user_id)>=200',
    '(tier <> ''pro'' and (select count(*) from public.scheduled_tasks where user_id=p_user_id)>=200)'
  );
  if updated=definition then raise exception 'scheduled_task_total_cap_source_mismatch';end if;
  -- Prevent plan capacity checks from rejecting Pro even after many records.
  updated := replace(
    updated,
    '>=cap then raise exception ''task_capacity''',
    '>=cap and tier <> ''pro'' then raise exception ''task_capacity'''
  );
  execute updated;
end
$$;
