-- Align the database with the active task limits shown in the Tasks workspace.
do $$
declare
  routine oid;
  definition text;
  before_caps constant text := 'case tier when ''pro'' then 75 when ''plus'' then 5 when ''free'' then 1 else 0 end';
  after_caps constant text := 'case tier when ''pro'' then null when ''plus'' then 5 when ''free'' then 2 else 0 end';
begin
  routine := 'public.mutate_scheduled_task(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure;
  definition := pg_get_functiondef(routine);
  if strpos(definition, before_caps) = 0 then
    raise exception 'scheduled_task_policy_source_mismatch';
  end if;
  -- NULL skips the tier-specific comparisons. The shared per-account
  -- retained-record and mutation receipt ceilings continue to apply.
  definition := replace(definition, before_caps, after_caps);
  definition := replace(definition, '>cap then raise exception ''task_capacity''',
    '+ (case when p_action=''retry'' then 1 else 0 end) > cap then raise exception ''task_capacity''');
  execute definition;
end
$$;
