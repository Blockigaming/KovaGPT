-- Forward-only policy update. Preserve the canonical task engine's consent,
-- ownership, deletion fences, connection checks, leases, and service-only grants.
-- Plus is the baseline: Free 1/5, Pro 15x. No runtime activation happens here.
do $$
declare item record; definition text; updated text; visited integer:=0;
begin
 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('mutate_scheduled_task','claim_due_scheduled_tasks','begin_scheduled_task_run','admit_scheduled_task_event','scheduled_task_check_execution') loop
  definition:=pg_get_functiondef(item.oid);
  updated:=replace(definition,'not in(''plus'',''pro'')','not in(''free'',''plus'',''pro'')');
  if item.proname='mutate_scheduled_task' then
   updated:=replace(updated,'case tier when ''pro'' then 20 when ''plus'' then 5 else 0 end','case tier when ''pro'' then 75 when ''plus'' then 5 when ''free'' then 1 else 0 end');
  end if;
  if item.proname='claim_due_scheduled_tasks' then
   updated:=replace(updated,'>=daily_limit then','>=greatest(1,floor(daily_limit * case public.effective_user_plan_tier(task.user_id) when ''free'' then 0.2 when ''plus'' then 1 when ''pro'' then 15 else 0 end)) then');
  end if;
  if updated=definition then raise exception 'scheduled_task_policy_source_mismatch: %',item.proname;end if;
  execute updated;visited:=visited+1;
 end loop;
 if visited<>5 then raise exception 'scheduled_task_foundation_missing';end if;
end$$;
