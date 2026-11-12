begin;

alter table public.scheduled_tasks
  add column task_kind text not null default 'prompt'
  check (task_kind = 'prompt' or (
    task_kind = 'reminder' and trigger_mode = 'time'
    and context_refs = '[]'::jsonb and event_triggers = '[]'::jsonb
  ));

alter table public.scheduled_task_copy_offers
  add column task_kind text not null default 'prompt'
  check (task_kind in ('prompt', 'reminder'));

alter table public.app_notifications drop constraint app_notifications_type_check;
alter table public.app_notifications add constraint app_notifications_type_check
  check (type in (
    'task_result','task_failure','reminder_ready','connector_reauth','shared_chat',
    'project_invitation','project_role_change','project_member_joined','billing_issue',
    'usage_threshold','deep_research_complete','file_processing','security_alert',
    'workspace_join_approved','workspace_join_denied'
  ));

-- Extend the current routines, preserving their admission, lease and delivery checks.
do $migration$
declare
  definition text;
  patch record;
begin
  definition := pg_get_functiondef(
    'public.mutate_scheduled_task(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure
  );
  for patch in select * from (values
    ('status,timezone,schedule_local)', 'status,timezone,schedule_local,task_kind)'),
    ('at time zone offered.timezone) returning * into task;', 'at time zone offered.timezone,offered.task_kind) returning * into task;'),
    ('event_triggers,automation_consent_at)', 'event_triggers,automation_consent_at,task_kind)'),
    ('refs,triggers,now()) returning * into task;', 'refs,triggers,now(),coalesce(p_payload->>''taskKind'',''prompt'')) returning * into task;'),
    ('recipient_id,title,prompt,repeat,timezone,schedule_local)', 'recipient_id,title,prompt,repeat,timezone,schedule_local,task_kind)'),
    ('task.timezone,task.schedule_local) returning scheduled_task_copy_offers.id', 'task.timezone,task.schedule_local,task.task_kind) returning scheduled_task_copy_offers.id')
  ) as edits(before_text, after_text)
  loop
    if strpos(definition, patch.before_text) = 0 then
      raise exception 'Unexpected scheduled task mutation routine';
    end if;
    definition := replace(definition, patch.before_text, patch.after_text);
  end loop;
  execute definition;

  definition := pg_get_functiondef(
    'public.settle_scheduled_task_success(uuid,text,timestamp with time zone,text,text)'::regprocedure
  );
  for patch in select * from (values
    ($before$v_preview := 'Your scheduled task completed. Open Tasks to view the result.';$before$,
     $after$v_preview := case when v_task.task_kind = 'reminder'
       then 'Your scheduled reminder is ready. Open Tasks to view it.'
       else 'Your scheduled task completed. Open Tasks to view the result.' end;$after$),
    ($before$'task_result',$before$,
     $after$case when v_task.task_kind = 'reminder' then 'reminder_ready' else 'task_result' end,$after$),
    ($before$left('Completed: ' || v_task.title, 240),$before$,
     $after$case when v_task.task_kind = 'reminder' then 'Reminder ready'
       else left('Completed: ' || v_task.title, 240) end,$after$),
    ($before$'/scheduled-tasks',$before$,
     $after$case when v_task.task_kind = 'reminder' then '/scheduled-tasks?taskId=' || v_task.id::text
       else '/scheduled-tasks' end,$after$)
  ) as edits(before_text, after_text)
  loop
    if strpos(definition, patch.before_text) = 0 then
      raise exception 'Unexpected scheduled task settlement routine';
    end if;
    definition := replace(definition, patch.before_text, patch.after_text);
  end loop;
  execute definition;

  -- A rolled-back worker can still claim prompt tasks, but must never pass
  -- reminder text to a model. Only workers using the new routine can claim reminders.
  definition := pg_get_functiondef('public.claim_due_scheduled_tasks(text,integer,integer)'::regprocedure);
  if strpos(definition, $old$st.status='scheduled' and st.automation_consent_at is not null$old$) = 0 then
    raise exception 'Unexpected scheduled task claim routine';
  end if;
  definition := replace(definition,
    'public.claim_due_scheduled_tasks(p_worker_id text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 120)',
    'kova_private.claim_due_scheduled_tasks_internal(p_worker_id text, p_limit integer, p_lease_seconds integer, p_allow_reminders boolean)');
  if strpos(definition, 'kova_private.claim_due_scheduled_tasks_internal(') = 0 then
    raise exception 'Unexpected scheduled task claim signature';
  end if;
  execute replace(definition,
    $old$st.status='scheduled' and st.automation_consent_at is not null$old$,
    $new$st.status='scheduled' and st.automation_consent_at is not null and (p_allow_reminders or st.task_kind='prompt')$new$);

  definition := pg_get_functiondef('public.web_push_rpc(uuid,text,jsonb)'::regprocedure);
  if strpos(definition, $old$'task_result','task_failure','deep_research_complete','file_processing'$old$) = 0 then
    raise exception 'Unexpected web push task preference mapping';
  end if;
  execute replace(definition,
    $old$'task_result','task_failure','deep_research_complete','file_processing'$old$,
    $new$'task_result','task_failure','reminder_ready','deep_research_complete','file_processing'$new$);
end;
$migration$;

create or replace function public.claim_due_scheduled_tasks(
  p_worker_id text, p_limit integer default 10, p_lease_seconds integer default 120
)
returns setof public.scheduled_tasks
language sql security invoker set search_path = ''
as $$
  select * from kova_private.claim_due_scheduled_tasks_internal(p_worker_id, p_limit, p_lease_seconds, false);
$$;

create function public.claim_due_scheduled_tasks_with_reminders(
  p_worker_id text, p_limit integer, p_lease_seconds integer
)
returns setof public.scheduled_tasks
language sql security invoker set search_path = ''
as $$
  select * from kova_private.claim_due_scheduled_tasks_internal(p_worker_id, p_limit, p_lease_seconds, true);
$$;

revoke all on function kova_private.claim_due_scheduled_tasks_internal(text,integer,integer,boolean)
  from public, anon, authenticated;
grant execute on function kova_private.claim_due_scheduled_tasks_internal(text,integer,integer,boolean)
  to service_role;

revoke all on function public.claim_due_scheduled_tasks_with_reminders(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_tasks_with_reminders(text,integer,integer)
  to service_role;

commit;
