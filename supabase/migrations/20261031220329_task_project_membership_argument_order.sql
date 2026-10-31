-- The established membership helper accepts (project_id, user_id). Correct
-- Tasks callers without changing the helper, existing grants or task consent.
do $task_project_membership$
declare
  item record;
  definition text;
  updated text;
begin
  if pg_get_function_identity_arguments('public.is_project_member(uuid,uuid)'::regprocedure)
      <> '_project_id uuid, _user_id uuid' then
    raise exception 'task_project_membership_signature_mismatch';
  end if;
  for item in select * from (values
    ('kova_private.validate_scheduled_task_context(uuid,jsonb,jsonb)',
     'public.is_project_member(p_user,p.id)', 'public.is_project_member(p.id,p_user)'),
    ('public.list_scheduled_task_context_options(uuid,text,uuid)',
     'public.is_project_member(p_user_id,p.id)', 'public.is_project_member(p.id,p_user_id)')
  ) as targets(signature, previous_call, correct_call) loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if (length(definition) - length(replace(definition, item.previous_call, '')))
        / length(item.previous_call) <> 1 then
      raise exception 'task_project_membership_source_mismatch: %', item.signature;
    end if;
    updated := replace(definition, item.previous_call, item.correct_call);
    execute updated;
  end loop;
end
$task_project_membership$;

-- The claim gate already scales this allowance by plan. Apply the same policy
-- at run admission so Pro is not capped at Plus usage and Free cannot race past
-- its smaller limit between claim and begin. Preserve all other lease checks.
do $task_daily_admission$
declare
  definition text;
  previous_limit text := '(select max_runs_per_user_day from public.scheduled_task_runtime where id)';
begin
  definition := pg_get_functiondef('public.begin_scheduled_task_run(uuid,text,timestamptz,text)'::regprocedure);
  if (length(definition) - length(replace(definition, previous_limit, '')))
      / length(previous_limit) <> 1 then
    raise exception 'task_daily_admission_source_mismatch';
  end if;
  execute replace(definition, previous_limit,
    '(select greatest(1,floor(max_runs_per_user_day * case public.effective_user_plan_tier(task.user_id) when ''free'' then 0.2 when ''plus'' then 1 when ''pro'' then 15 else 0 end)) from public.scheduled_task_runtime where id)');
end
$task_daily_admission$;
