-- Customer task counts: Free 2, Plus 5, Pro no product count limit.
-- Preserve account locks, grants, consent, leases, run budgets and owner checks.
do $$
declare definition text; updated text;
begin
 definition := pg_get_functiondef('public.mutate_scheduled_task(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure);
 updated := replace(definition,
   'case tier when ''pro'' then 75 when ''plus'' then 5 when ''free'' then 1 else 0 end',
   'case tier when ''pro'' then null when ''plus'' then 5 when ''free'' then 2 else 0 end');
 if updated = definition then raise exception 'scheduled_task_customer_limits_source_mismatch'; end if;
 -- NULL means uncapped: SQL comparisons against cap are false for Pro.
 -- Remove the older total-row ceiling for Pro as well.
 updated := replace(updated,
   'if p_action in(''create'',''acceptCopy'') and (select count(*) from public.scheduled_tasks where user_id=p_user_id)>=200',
   'if tier<>''pro'' and p_action in(''create'',''acceptCopy'') and (select count(*) from public.scheduled_tasks where user_id=p_user_id)>=200');
 if position('if tier<>''pro'' and p_action' in updated)=0 then raise exception 'scheduled_task_total_limits_source_mismatch'; end if;
 execute updated;
end $$;
