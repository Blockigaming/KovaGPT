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
