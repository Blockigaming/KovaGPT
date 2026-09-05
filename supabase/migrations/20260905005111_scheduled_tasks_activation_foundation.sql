-- Runtime activation remains disabled until an operator approves policy and a
-- configured, authenticated scheduler records a fresh heartbeat. No live cron.
begin;
alter table public.scheduled_tasks
 add column revision bigint not null default 1 check(revision>0),
 add column trigger_mode text not null default 'time' check(trigger_mode in('time','event')),
 add column timezone text not null default 'UTC',
 add column schedule_local timestamp without time zone,
 add column context_refs jsonb not null default '[]' check(jsonb_typeof(context_refs)='array' and jsonb_array_length(context_refs)<=8 and pg_column_size(context_refs)<=32768),
 add column event_triggers jsonb not null default '[]' check(jsonb_typeof(event_triggers)='array' and jsonb_array_length(event_triggers)<=3 and pg_column_size(event_triggers)<=8192),
 add column automation_consent_at timestamptz,
 add column current_event_id uuid,
 add column execution_policy_version text;
update public.scheduled_tasks set schedule_local=run_at at time zone 'UTC';
alter table public.scheduled_tasks alter column schedule_local set not null;
alter table public.scheduled_tasks add constraint scheduled_tasks_trigger_exclusive check(
 (trigger_mode='time' and jsonb_array_length(event_triggers)=0) or (trigger_mode='event' and repeat='none' and jsonb_array_length(event_triggers) between 1 and 3));
revoke insert,update,delete on public.scheduled_tasks from public,anon,authenticated;
drop policy if exists "Users manage their own scheduled tasks" on public.scheduled_tasks;
create policy scheduled_tasks_current_owner on public.scheduled_tasks for select to authenticated
 using(user_id=(select auth.uid()) and not exists(select 1 from public.account_deletion_fences f where f.user_id=(select auth.uid())));

create table public.scheduled_task_runtime (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 policy_version text,
 heartbeat_at timestamptz,
 max_runs_per_user_day integer not null default 20 check(max_runs_per_user_day between 1 and 100),
 enabled_event_providers text[] not null default '{}' check(enabled_event_providers<@array['gmail','slack','github']::text[])
);
insert into public.scheduled_task_runtime(id) values(true);
create table public.scheduled_task_connection_grants (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider in('gmail','slack','github')),
 connection_ref text not null check(char_length(connection_ref) between 1 and 200),
 connection_generation text not null check(char_length(connection_generation) between 1 and 128),
 provider_account_id text not null check(char_length(provider_account_id) between 1 and 300),
 required_scopes text[] not null,
 granted_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',revoked_at timestamptz
);
create index scheduled_task_grants_user on public.scheduled_task_connection_grants(user_id,id);
create table public.scheduled_task_events (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.scheduled_tasks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,grant_id uuid not null references public.scheduled_task_connection_grants(id) on delete cascade,
 event_key text not null check(char_length(event_key) between 1 and 250),
 event_data jsonb not null check(jsonb_typeof(event_data)='object' and pg_column_size(event_data)<=16384),
 state text not null default 'pending' check(state in('pending','running','completed','failed','canceled')),
 received_at timestamptz not null default now(),scheduled_for timestamptz,
 unique(task_id,grant_id,event_key)
);
create index scheduled_task_events_due on public.scheduled_task_events(task_id,received_at,id) where state='pending';
create table public.scheduled_task_copy_offers (
 id uuid primary key default gen_random_uuid(),source_task_id uuid references public.scheduled_tasks(id) on delete set null,
 owner_id uuid not null references auth.users(id) on delete cascade,recipient_id uuid not null references auth.users(id) on delete cascade,
 title text not null,prompt text not null,repeat text not null,timezone text not null,schedule_local timestamp not null,
 state text not null default 'pending' check(state in('pending','accepted','declined','revoked')),
 expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now(),copied_task_id uuid
);
create index scheduled_task_copies_recipient on public.scheduled_task_copy_offers(recipient_id,created_at,id);
create table public.scheduled_task_mutation_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,mutation_id uuid not null,request_hash text not null,
 result jsonb not null check(pg_column_size(result)<=16384),created_at timestamptz not null default now(),primary key(user_id,mutation_id)
);
do $$declare t text;begin
 foreach t in array array['scheduled_task_runtime','scheduled_task_connection_grants','scheduled_task_events','scheduled_task_copy_offers','scheduled_task_mutation_receipts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end$$;
grant select on public.scheduled_task_copy_offers,public.scheduled_task_connection_grants,public.scheduled_task_events to authenticated;
create policy scheduled_task_copy_participant on public.scheduled_task_copy_offers for select to authenticated using(owner_id=(select auth.uid()) or recipient_id=(select auth.uid()));
create policy scheduled_task_grant_owner on public.scheduled_task_connection_grants for select to authenticated using(user_id=(select auth.uid()));
create policy scheduled_task_event_owner on public.scheduled_task_events for select to authenticated using(user_id=(select auth.uid()));

do $$declare t text;begin
 foreach t in array array['scheduled_task_runs','scheduled_task_copy_offers','scheduled_task_connection_grants','scheduled_task_events'] loop
 execute format('create policy task_account_fence_read on public.%I as restrictive for select to authenticated using(not exists(select 1 from public.account_deletion_fences where user_id=(select auth.uid())))',t);
 end loop;
end$$;
create function public.scheduled_task_account_available(p_user_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$select coalesce(kova_private.auth_user_exists(p_user_id),false) and not exists(select 1 from public.account_deletion_fences where user_id=p_user_id)$$;
revoke all on function public.scheduled_task_account_available(uuid) from public,anon,authenticated;
grant execute on function public.scheduled_task_account_available(uuid) to service_role;

-- PostgreSQL resolves a nonexistent local clock time using the pre-transition
-- offset (advancing by the gap) and an ambiguous time using the later standard
-- offset. Month arithmetic always starts from the original local anchor.
create function kova_private.next_task_occurrence(p_anchor timestamp,p_repeat text,p_zone text,p_after timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path='' as $$
declare n integer; candidate timestamptz; local_after timestamp; step integer;begin
 if p_repeat='none' then return null; end if;
 if p_anchor is null or p_after is null or p_repeat not in('daily','weekly','monthly')
   or not exists(select 1 from pg_timezone_names where name=p_zone) then raise exception 'task_schedule_invalid' using errcode='22023'; end if;
 local_after:=p_after at time zone p_zone;
 if p_repeat='monthly' then n:=greatest(0,(extract(year from local_after)::integer-extract(year from p_anchor)::integer)*12+extract(month from local_after)::integer-extract(month from p_anchor)::integer);
 else n:=greatest(0,(local_after::date-p_anchor::date)/(case when p_repeat='weekly' then 7 else 1 end)); end if;
 for step in 0..3 loop
  candidate:=(p_anchor+case p_repeat when 'monthly' then make_interval(months=>n+step) when 'weekly' then make_interval(days=>(n+step)*7) else make_interval(days=>n+step) end) at time zone p_zone;
  if candidate>p_after then return candidate; end if;
 end loop;
 raise exception 'task_schedule_invalid' using errcode='22023';
end$$;
revoke all on function kova_private.next_task_occurrence(timestamp,text,text,timestamptz) from public,anon,authenticated;
grant execute on function kova_private.next_task_occurrence(timestamp,text,text,timestamptz) to service_role;
create function public.scheduled_task_heartbeat(p_policy_version text)
returns boolean language plpgsql security invoker set search_path='' as $$begin
 update public.scheduled_task_runtime set heartbeat_at=now() where id and enabled and policy_version=p_policy_version and char_length(policy_version) between 1 and 80;
 return found;
end$$;
create function public.scheduled_task_runtime_ready(p_policy_version text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.scheduled_task_runtime where id and enabled and policy_version=p_policy_version and heartbeat_at>now()-interval '5 minutes')
$$;
revoke all on function public.scheduled_task_heartbeat(text),public.scheduled_task_runtime_ready(text) from public,anon,authenticated;
grant execute on function public.scheduled_task_heartbeat(text),public.scheduled_task_runtime_ready(text) to service_role;

create function kova_private.lock_scheduled_task_account(p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,20260903204500));
 if p_user is null or not kova_private.auth_user_exists(p_user) or exists(select 1 from public.account_deletion_fences where user_id=p_user) then raise exception 'task_account_unavailable' using errcode='42501'; end if;
end$$;
revoke all on function kova_private.lock_scheduled_task_account(uuid) from public,anon,authenticated;
grant execute on function kova_private.lock_scheduled_task_account(uuid) to service_role;

create function kova_private.validate_scheduled_task_context(p_user uuid,p_refs jsonb,p_triggers jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; grant_id uuid;begin
 if jsonb_typeof(p_refs) is distinct from 'array' or jsonb_array_length(p_refs)>8 or pg_column_size(p_refs)>32768
  or jsonb_typeof(p_triggers) is distinct from 'array' or jsonb_array_length(p_triggers)>3 or pg_column_size(p_triggers)>8192 then raise exception 'task_context_invalid' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_refs) loop
  if item->>'kind'='library' then
   if not exists(select 1 from public.user_library_items where id=(item->>'id')::uuid and user_id=p_user) then raise exception 'task_context_unavailable' using errcode='42501'; end if;
  elsif item->>'kind'='snapshot' then
   if char_length(coalesce(item->>'text','')) not between 1 and 14000 then raise exception 'task_context_invalid' using errcode='22023'; end if;
  elsif item->>'kind'='project_file' then
   if not exists(select 1 from public.project_files pf join public.projects p on p.id=pf.project_id where pf.id=(item->>'id')::uuid and p.id=(item->>'projectId')::uuid
    and p.deletion_requested_at is null and pf.status='ready' and pf.account_cleanup_user_id is null and public.is_project_member(p_user,p.id)) then raise exception 'task_context_unavailable' using errcode='42501'; end if;
  elsif item->>'kind'<>'connected' or item->>'kind' is null then raise exception 'task_context_invalid' using errcode='22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_triggers) loop
  if not exists(select 1 from public.scheduled_task_runtime where id and enabled and item->>'provider'=any(enabled_event_providers)) or not public.scheduled_task_event_grant_ready((item->>'grantId')::uuid) then raise exception 'task_events_unavailable' using errcode='55000'; end if;
 end loop;
 for grant_id in select distinct (value->>'grantId')::uuid from jsonb_array_elements(p_refs||p_triggers) where value ? 'grantId' loop
  if not exists(select 1 from public.scheduled_task_connection_grants g where g.id=grant_id and g.user_id=p_user and g.revoked_at is null and g.expires_at>now() and kova_private.scheduled_task_connection_current(g.user_id,g.provider,g.connection_ref,g.connection_generation,g.provider_account_id,g.required_scopes)) then raise exception 'task_connection_unavailable' using errcode='42501'; end if;
 end loop;
end$$;
revoke all on function kova_private.validate_scheduled_task_context(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function kova_private.validate_scheduled_task_context(uuid,jsonb,jsonb) to service_role;

create function public.mutate_scheduled_task(p_user_id uuid,p_mutation_id uuid,p_task_id uuid,p_expected_revision bigint,p_action text,p_payload jsonb,p_policy_version text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare task public.scheduled_tasks%rowtype; receipt public.scheduled_task_mutation_receipts%rowtype; tier text; cap integer;
 fingerprint text; result jsonb; mode text; zone text; local_anchor timestamp; first_at timestamptz; refs jsonb; triggers jsonb; offered public.scheduled_task_copy_offers%rowtype; recipient uuid; other_user uuid; v_offer_id uuid;
begin
 if p_mutation_id is null or p_task_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>49152 then raise exception 'task_request_invalid' using errcode='22023'; end if;
 fingerprint:=md5(jsonb_build_object('task',p_task_id,'revision',p_expected_revision,'action',p_action,'payload',p_payload)::text);
 if p_action='shareCopy' then
  -- A completed offer retries its receipt before a later cap/recipient change;
  -- this read cannot create a second offer or grant any new authority.
  select * into receipt from public.scheduled_task_mutation_receipts where user_id=p_user_id and mutation_id=p_mutation_id;
  if found then
   if receipt.request_hash<>fingerprint then raise exception 'task_idempotency_conflict' using errcode='40001'; end if;
   if not public.scheduled_task_account_available(p_user_id) then raise exception 'task_account_unavailable' using errcode='42501'; end if;
   return receipt.result;
  end if;
  if not exists(select 1 from public.scheduled_tasks where id=p_task_id and user_id=p_user_id) then raise exception 'task_forbidden' using errcode='42501'; end if;
  if (select count(*) from public.scheduled_task_copy_offers where owner_id=p_user_id and state='pending' and expires_at>now())>=20 then raise exception 'task_copy_capacity' using errcode='54000'; end if;
  recipient:=kova_private.verified_auth_user_for_email(p_payload->>'email');
  if recipient is null or recipient=p_user_id then raise exception 'task_recipient_unavailable' using errcode='22023'; end if;
 elsif p_action in('acceptCopy','declineCopy') then
  select owner_id into recipient from public.scheduled_task_copy_offers where id=(p_payload->>'offerId')::uuid and recipient_id=p_user_id;
 end if;
 for other_user in select distinct u from unnest(array[p_user_id,recipient]) u where u is not null order by u loop perform kova_private.lock_scheduled_task_account(other_user); end loop;
 fingerprint:=md5(jsonb_build_object('task',p_task_id,'revision',p_expected_revision,'action',p_action,'payload',p_payload)::text);
 select * into receipt from public.scheduled_task_mutation_receipts where user_id=p_user_id and mutation_id=p_mutation_id;
 if found then
  if receipt.request_hash<>fingerprint then raise exception 'task_idempotency_conflict' using errcode='40001'; end if;
  return receipt.result;
 end if;
 if (select count(*) from public.scheduled_task_mutation_receipts where user_id=p_user_id)>=10000 then raise exception 'task_receipt_capacity' using errcode='54000'; end if;
 tier:=public.effective_user_plan_tier(p_user_id);cap:=case tier when 'pro' then 20 when 'plus' then 5 else 0 end;
 if p_action not in('delete','pause','revokeCopy','declineCopy') and cap=0 then raise exception 'task_plan_required' using errcode='42501'; end if;
 if p_action in('create','resume','retry') and not public.scheduled_task_runtime_ready(p_policy_version) then raise exception 'task_execution_unavailable' using errcode='55000'; end if;
 if p_action in('create','acceptCopy') and (select count(*) from public.scheduled_tasks where user_id=p_user_id)>=200 then raise exception 'task_total_capacity' using errcode='54000'; end if;
 if p_action='acceptCopy' then
  select * into offered from public.scheduled_task_copy_offers where id=(p_payload->>'offerId')::uuid and recipient_id=p_user_id and state='pending' and expires_at>now() for update;
  if not found or p_expected_revision<>0 then raise exception 'task_copy_unavailable' using errcode='40001'; end if;
  if (select count(*) from public.scheduled_tasks where user_id=p_user_id and status in('scheduled','running','paused'))>=cap then raise exception 'task_capacity' using errcode='54000'; end if;
  -- Only prompt and time preferences are copied. Credentials, event triggers,
  -- uploaded/connected context, and background-execution consent never travel.
  insert into public.scheduled_tasks(id,user_id,title,prompt,run_at,next_run_at,repeat,status,timezone,schedule_local)
   values(p_task_id,p_user_id,offered.title,offered.prompt,now()+interval '1 day',now()+interval '1 day',offered.repeat,'paused',offered.timezone,(now()+interval '1 day') at time zone offered.timezone) returning * into task;
  update public.scheduled_task_copy_offers set state='accepted',copied_task_id=p_task_id where id=offered.id;
 elsif p_action='declineCopy' then
  update public.scheduled_task_copy_offers set state='declined' where id=(p_payload->>'offerId')::uuid and recipient_id=p_user_id and state='pending' and expires_at>now();
  if not found then raise exception 'task_copy_unavailable' using errcode='40001'; end if;
 elsif p_action='create' then
  if p_expected_revision<>0 then raise exception 'task_revision_conflict' using errcode='40001'; end if;
  if (select count(*) from public.scheduled_tasks where user_id=p_user_id and status in('scheduled','running','paused'))>=cap then raise exception 'task_capacity' using errcode='54000'; end if;
  mode:=coalesce(p_payload->>'triggerMode','time');zone:=coalesce(p_payload->>'timezone','UTC');
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'task_schedule_invalid' using errcode='22023'; end if;
  local_anchor:=coalesce((p_payload->>'localTime')::timestamp,(p_payload->>'run_at')::timestamptz at time zone zone);
  first_at:=date_trunc('milliseconds',local_anchor at time zone zone);
  if mode='event' then local_anchor:=now() at time zone zone;first_at:=now(); end if;
  refs:=coalesce(p_payload->'contextRefs','[]');triggers:=coalesce(p_payload->'eventTriggers','[]');
  perform kova_private.validate_scheduled_task_context(p_user_id,refs,triggers);
  if char_length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 200 or char_length(btrim(coalesce(p_payload->>'prompt',''))) not between 1 and 4000
   or (mode='time' and (first_at is null or first_at<now()-interval '1 minute' or first_at>now()+interval '2 years')) then raise exception 'task_request_invalid' using errcode='22023'; end if;
  insert into public.scheduled_tasks(id,user_id,title,prompt,run_at,next_run_at,repeat,status,trigger_mode,timezone,schedule_local,context_refs,event_triggers,automation_consent_at)
   values(p_task_id,p_user_id,btrim(p_payload->>'title'),btrim(p_payload->>'prompt'),first_at,case when mode='time' then first_at end,
    coalesce(p_payload->>'repeat','none'),'scheduled',mode,zone,local_anchor,refs,triggers,now()) returning * into task;
 else
  select * into task from public.scheduled_tasks where id=p_task_id and user_id=p_user_id for update;
  if not found then raise exception 'task_not_found' using errcode='P0002'; end if;
  if task.revision<>p_expected_revision then raise exception 'task_revision_conflict' using errcode='40001'; end if;
  if p_action='edit' then
   if task.status='running' then raise exception 'task_running_conflict' using errcode='40001'; end if;
   zone:=coalesce(p_payload->>'timezone',task.timezone);
   if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'task_schedule_invalid' using errcode='22023'; end if;
   local_anchor:=coalesce((p_payload->>'localTime')::timestamp,(p_payload->>'run_at')::timestamptz at time zone zone,task.schedule_local);
   refs:=coalesce(p_payload->'contextRefs',task.context_refs);triggers:=coalesce(p_payload->'eventTriggers',task.event_triggers);
   perform kova_private.validate_scheduled_task_context(p_user_id,refs,triggers);
   if char_length(btrim(coalesce(p_payload->>'title',task.title))) not between 1 and 200 or char_length(btrim(coalesce(p_payload->>'prompt',task.prompt))) not between 1 and 4000 then raise exception 'task_request_invalid' using errcode='22023'; end if;
   update public.scheduled_tasks set title=coalesce(p_payload->>'title',title),prompt=coalesce(p_payload->>'prompt',prompt),repeat=coalesce(p_payload->>'repeat',repeat),timezone=zone,schedule_local=local_anchor,
    run_at=local_anchor at time zone zone,next_run_at=case when coalesce(p_payload->>'triggerMode',trigger_mode)='time' then local_anchor at time zone zone end,
    trigger_mode=coalesce(p_payload->>'triggerMode',trigger_mode),context_refs=refs,event_triggers=triggers,
    status='paused',automation_consent_at=null,retry_after=null where id=task.id;
   update public.scheduled_task_events set state='canceled' where task_id=task.id and state in('pending','running');
  elsif p_action in('resume','retry') then
   if (p_action='retry' and task.status<>'failed') or (p_action='resume' and task.status<>'paused') then raise exception 'task_transition_conflict' using errcode='40001'; end if;
   perform kova_private.validate_scheduled_task_context(p_user_id,task.context_refs,task.event_triggers);
   if (select count(*) from public.scheduled_tasks where user_id=p_user_id and status in('scheduled','running','paused'))>cap then raise exception 'task_capacity' using errcode='54000'; end if;
   if task.trigger_mode='time' then
    first_at:=case when task.repeat='none' then date_trunc('milliseconds',greatest(task.run_at,now())) else kova_private.next_task_occurrence(task.schedule_local,task.repeat,task.timezone,now()-interval '1 second') end;
   end if;
   update public.scheduled_tasks set status='scheduled',automation_consent_at=now(),next_run_at=first_at,retry_after=null,execution_attempts=0,worker_id=null,lease_expires_at=null,current_event_id=null where id=task.id;
  elsif p_action='pause' then
   if task.status not in('scheduled','running','paused') then raise exception 'task_transition_conflict' using errcode='40001'; end if;
   update public.scheduled_tasks set status='paused',automation_consent_at=null,worker_id=null,lease_expires_at=null,retry_after=null where id=task.id;
   update public.scheduled_task_runs set status='canceled',completed_at=now() where task_id=task.id and status='running';
   update public.scheduled_task_events set state='canceled' where task_id=task.id and state in('pending','running');
  elsif p_action='shareCopy' then
   if (select count(*) from public.scheduled_task_copy_offers where owner_id=p_user_id and state='pending' and expires_at>now())>=20 then raise exception 'task_copy_capacity' using errcode='54000'; end if;
   if (select count(*) from public.scheduled_task_copy_offers where recipient_id=recipient and state='pending' and expires_at>now())>=100 then raise exception 'task_recipient_capacity' using errcode='54000'; end if;
   insert into public.scheduled_task_copy_offers(source_task_id,owner_id,recipient_id,title,prompt,repeat,timezone,schedule_local)
    values(task.id,p_user_id,recipient,task.title,task.prompt,task.repeat,task.timezone,task.schedule_local) returning scheduled_task_copy_offers.id into v_offer_id;
  elsif p_action='revokeCopy' then
   update public.scheduled_task_copy_offers set state='revoked' where scheduled_task_copy_offers.id=(p_payload->>'offerId')::uuid and owner_id=p_user_id and source_task_id=task.id and state='pending';
   if not found then raise exception 'task_copy_unavailable' using errcode='40001'; end if;
  elsif p_action='delete' then
   update public.scheduled_task_copy_offers set state='revoked' where source_task_id=task.id and state='pending';
   delete from public.scheduled_tasks where scheduled_tasks.id=task.id;
  else raise exception 'task_action_invalid' using errcode='22023'; end if;
  if p_action<>'delete' then update public.scheduled_tasks set revision=revision+1,updated_at=now() where scheduled_tasks.id=task.id returning * into task; end if;
 end if;
 insert into public.account_audit_entries(user_id,event_type,safe_description,actor_id,target_id,result,metadata)
 values(p_user_id,'scheduled_task_change','Scheduled task '||p_action,p_user_id,p_task_id::text,'success',jsonb_build_object('action',p_action));
 result:=jsonb_build_object('taskId',case when p_action in('delete','declineCopy') then null else task.id end,'revision',task.revision,'offerId',v_offer_id,'action',p_action);
 insert into public.scheduled_task_mutation_receipts(user_id,mutation_id,request_hash,result) values(p_user_id,p_mutation_id,fingerprint,result);
 return result;
end$$;
revoke all on function public.mutate_scheduled_task(uuid,uuid,uuid,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.mutate_scheduled_task(uuid,uuid,uuid,bigint,text,jsonb,text) to service_role;

create or replace function public.claim_due_scheduled_tasks(p_worker_id text,p_limit integer default 10,p_lease_seconds integer default 120)
returns setof public.scheduled_tasks language plpgsql security invoker set search_path='' as $$
declare candidate record; task public.scheduled_tasks%rowtype; event public.scheduled_task_events%rowtype; claimed integer:=0; daily_limit integer; current_policy text;begin
 if p_worker_id is null or char_length(p_worker_id) not between 1 and 120 then raise exception 'worker_id_required' using errcode='22023'; end if;
 select max_runs_per_user_day,policy_version into daily_limit,current_policy from public.scheduled_task_runtime where id and enabled and heartbeat_at>now()-interval '5 minutes';
 if not found then return; end if;
 for candidate in select id,user_id from public.scheduled_tasks st where st.status='scheduled' and st.automation_consent_at is not null
  and (coalesce(st.retry_after,st.next_run_at,st.run_at)<=now() and st.trigger_mode='time'
   or st.trigger_mode='event' and (st.retry_after is null or st.retry_after<=now()) and (st.current_event_id is not null or exists(select 1 from public.scheduled_task_events e where e.task_id=st.id and e.state='pending')))
  order by coalesce(st.retry_after,st.next_run_at,st.updated_at),st.id limit 100 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.user_id::text,20260903204500)) then continue; end if;
  if exists(select 1 from public.account_deletion_fences where user_id=candidate.user_id) then continue; end if;
  select * into task from public.scheduled_tasks where id=candidate.id and status='scheduled' for update skip locked;
  if not found then continue; end if;
  if public.effective_user_plan_tier(task.user_id) not in('plus','pro') then
   update public.scheduled_tasks set status='paused',automation_consent_at=null,last_failure_type='authorization',last_error='Task plan access must be renewed.' where id=task.id;continue;
  end if;
  begin
   perform kova_private.validate_scheduled_task_context(task.user_id,task.context_refs,task.event_triggers);
  exception when sqlstate '42501' or sqlstate '55000' then
   update public.scheduled_tasks set status='paused',automation_consent_at=null,last_failure_type='authorization',last_error='A selected source or connection is no longer available.' where id=task.id;
   update public.scheduled_task_events set state='canceled' where task_id=task.id and state in('pending','running');continue;
  end;
  if (select count(*) from public.scheduled_task_runs where user_id=task.user_id and started_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=daily_limit then
   update public.scheduled_tasks set retry_after=(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC' where id=task.id;continue;
  end if;
  if task.trigger_mode='event' then
   select * into event from public.scheduled_task_events where task_id=task.id and
    ((task.current_event_id is not null and id=task.current_event_id and state='running') or (task.current_event_id is null and state='pending'))
    order by received_at,id limit 1 for update skip locked;
   if not found then continue; end if;
   if event.scheduled_for is null then
    event.scheduled_for:=greatest(date_trunc('milliseconds',now()),coalesce((select max(scheduled_for)+interval '1 millisecond' from public.scheduled_task_runs where task_id=task.id),'-infinity'::timestamptz));
   end if;
   update public.scheduled_task_events set state='running',scheduled_for=event.scheduled_for where id=event.id;
   task.next_run_at:=event.scheduled_for;task.current_event_id:=event.id;
  end if;
  update public.scheduled_tasks set status='running',worker_id=p_worker_id,lease_expires_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,120),300))),
   execution_attempts=execution_attempts+1,retry_after=null,execution_policy_version=current_policy,next_run_at=task.next_run_at,current_event_id=task.current_event_id,updated_at=now()
   where id=task.id returning * into task;
  return next task;claimed:=claimed+1;
  if claimed>=greatest(1,least(coalesce(p_limit,1),10)) then return; end if;
 end loop;
end$$;
revoke all on function public.claim_due_scheduled_tasks(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_due_scheduled_tasks(text,integer,integer) to service_role;
create or replace function public.recover_expired_scheduled_task_leases()
returns integer language plpgsql security invoker set search_path='' as $$
declare candidate record; task public.scheduled_tasks%rowtype; total integer:=0; retry_at timestamptz;begin
 for candidate in select id,user_id from public.scheduled_tasks where status='running' and lease_expires_at<=now() order by lease_expires_at,id limit 100 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.user_id::text,20260903204500)) then continue; end if;
  if exists(select 1 from public.account_deletion_fences where user_id=candidate.user_id) then continue; end if;
  select * into task from public.scheduled_tasks where id=candidate.id and status='running' and lease_expires_at<=now() for update skip locked;
  if not found then continue; end if;
  retry_at:=case when task.execution_attempts<4 then now()+make_interval(secs=>least(1800,60*(2^greatest(0,task.execution_attempts-1))::integer)) end;
  update public.scheduled_tasks set status=case when retry_at is null then 'failed' else 'scheduled' end,worker_id=null,lease_expires_at=null,retry_after=retry_at,updated_at=now(),
   last_failure_type='timeout',last_error='A worker lease expired.' where id=task.id;
  update public.scheduled_task_runs set status='failed',completed_at=now(),failure_type='timeout',retry_eligible=retry_at is not null,next_run_at=retry_at,
   result_summary='The task worker timed out.',safe_logs=array_append(coalesce(safe_logs,'{}'),'Worker lease expired.')
   where task_id=task.id and status='running';
  if retry_at is null then
   update public.scheduled_task_events set state='failed' where id=task.current_event_id;
   if coalesce((select in_app_enabled and coalesce((categories->>'tasks')::boolean,true) from public.notification_preferences where user_id=task.user_id),true) then
    insert into public.app_notifications(owner_id,type,title,safe_preview,action_url,source_entity,delivery_state)
     values(task.user_id,'task_failure',left('Task issue: '||task.title,240),'The worker timed out after repeated attempts. Open Tasks to review and retry.','/scheduled-tasks','scheduled_task:'||task.id::text,'delivered');
   end if;
  end if;
  total:=total+1;
 end loop;
 return total;
end$$;
revoke all on function public.recover_expired_scheduled_task_leases() from public,anon,authenticated;
grant execute on function public.recover_expired_scheduled_task_leases() to service_role;

create function public.begin_scheduled_task_run(p_task_id uuid,p_worker_id text,p_scheduled_for timestamptz,p_run_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare task public.scheduled_tasks%rowtype; result jsonb;begin
 select * into task from public.scheduled_tasks where id=p_task_id;
 if not found then raise exception 'scheduled_execution_lease_not_owned' using errcode='55000'; end if;
 perform kova_private.lock_scheduled_task_account(task.user_id);
 select * into task from public.scheduled_tasks where id=p_task_id and status='running' and worker_id=p_worker_id and lease_expires_at>now()
  and coalesce(next_run_at,run_at)=p_scheduled_for and automation_consent_at is not null for update;
 if not found then raise exception 'scheduled_execution_lease_not_owned' using errcode='55000'; end if;
 if not public.scheduled_task_runtime_ready(task.execution_policy_version) then raise exception 'task_execution_unavailable' using errcode='55000'; end if;
 if public.effective_user_plan_tier(task.user_id) not in('plus','pro') then raise exception 'task_plan_required' using errcode='42501'; end if;
 perform kova_private.validate_scheduled_task_context(task.user_id,task.context_refs,task.event_triggers);
 if p_run_id is distinct from task.id::text||':'||(extract(epoch from p_scheduled_for)*1000)::bigint::text then raise exception 'scheduled_execution_identity_invalid' using errcode='22023'; end if;
 if not exists(select 1 from public.scheduled_task_runs where task_id=task.id and scheduled_for=p_scheduled_for) and (select count(*) from public.scheduled_task_runs where user_id=task.user_id and started_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= (select max_runs_per_user_day from public.scheduled_task_runtime where id) then raise exception 'task_daily_capacity' using errcode='54000'; end if;
 insert into public.scheduled_task_runs(id,task_id,user_id,scheduled_for,started_at,status,delivery_status,safe_logs)
  values(p_run_id,task.id,task.user_id,p_scheduled_for,now(),'running','pending',array['Execution claimed by the trusted scheduler.'])
  on conflict(task_id,scheduled_for) do update set status='running',started_at=now(),completed_at=null,delivery_status='pending',failure_type=null,retry_eligible=false;
 select jsonb_build_object('task',to_jsonb(task),'plan',public.effective_user_plan_tier(task.user_id),
  'event',(select event_data from public.scheduled_task_events where id=task.current_event_id),
  'connectionGrants',coalesce((select jsonb_agg(to_jsonb(g)) from public.scheduled_task_connection_grants g where g.user_id=task.user_id and g.revoked_at is null and g.expires_at>now()
   and exists(select 1 from jsonb_array_elements(task.context_refs||task.event_triggers) ref where ref->>'grantId'=g.id::text)),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.begin_scheduled_task_run(uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.begin_scheduled_task_run(uuid,text,timestamptz,text) to service_role;

create or replace function public.settle_scheduled_task_success(
  p_task_id uuid,
  p_worker_id text,
  p_scheduled_for timestamptz,
  p_run_id text,
  p_result text
)
returns table (
  next_run_at timestamptz,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_owner uuid;
  v_next timestamptz;
  v_preview text;
  v_notify boolean := true;
  v_delivery text := 'pending';
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden'
      using errcode = '42501';
  end if;

  if nullif(trim(p_worker_id), '') is null
    or nullif(trim(p_run_id), '') is null then
    raise exception 'scheduled_execution_identity_required'
      using errcode = '22023';
  end if;

  select user_id into v_owner from public.scheduled_tasks where id=p_task_id;
  if v_owner is null then raise exception 'scheduled_execution_lease_not_owned' using errcode='55000'; end if;
  perform kova_private.lock_scheduled_task_account(v_owner);
  select *
  into v_task
  from public.scheduled_tasks
  where id = p_task_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_expires_at > now()
  for update;

  if not found then
    raise exception 'scheduled_execution_lease_not_owned'
      using errcode = '55000';
  end if;

  if not public.scheduled_task_check_execution(p_task_id,p_worker_id) then raise exception 'task_authorization_changed' using errcode='42501'; end if;
  if p_scheduled_for is distinct from coalesce(v_task.next_run_at,v_task.run_at) then raise exception 'scheduled_execution_identity_invalid' using errcode='22023'; end if;
  v_next := case when v_task.trigger_mode='event' then null else kova_private.next_task_occurrence(v_task.schedule_local,v_task.repeat,v_task.timezone,greatest(p_scheduled_for,now())) end;
  update public.scheduled_task_events set state='completed' where id=v_task.current_event_id;

  v_preview := 'Your scheduled task completed. Open Tasks to view the result.';

  update public.scheduled_tasks
  set
    status = case
      when v_task.trigger_mode='event' then 'scheduled'
      when v_next is null then 'completed'
      else 'scheduled'
    end,
    last_run_at = now(),
    next_run_at = v_next,
    last_result = left(coalesce(p_result, ''), 12000),
    current_event_id = null,
    worker_id = null,
    lease_expires_at = null,
    retry_after = null,
    execution_attempts = 0,
    last_failure_type = null,
    last_error = null,
    updated_at = now()
  where id = p_task_id;

  update public.scheduled_task_runs
  set
    status = 'complete',
    completed_at = now(),
    result_summary = left(coalesce(p_result, ''), 12000),
    delivery_status = 'pending',
    failure_type = null,
    retry_eligible = false,
    next_run_at = v_next,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      'Task execution completed successfully.'
    )
  where id = p_run_id
    and task_id = p_task_id
    and user_id = v_task.user_id;

  if not found then
    raise exception 'scheduled_run_not_owned'
      using errcode = '55000';
  end if;

  select
    coalesce(np.in_app_enabled, true)
    and coalesce((np.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences np
  where np.user_id = v_task.user_id;

  if not found then
    v_notify := true;
  end if;

  if v_notify then
    begin
      insert into public.app_notifications (
        owner_id,
        type,
        title,
        safe_preview,
        action_url,
        source_entity,
        delivery_state
      )
      values (
        v_task.user_id,
        'task_result',
        left('Completed: ' || v_task.title, 240),
        v_preview,
        '/scheduled-tasks',
        'scheduled_task:' || v_task.id::text,
        'delivered'
      );

      insert into public.notification_deliveries (
        user_id,
        task_run_id,
        channel,
        status,
        preview,
        delivered_at
      )
      values (
        v_task.user_id,
        p_run_id,
        'in_app',
        'sent',
        v_preview,
        now()
      );

      v_delivery := 'sent';
    exception
      when others then
        v_delivery := 'failed';
    end;
  else
    v_delivery := 'not_configured';
  end if;

  update public.scheduled_task_runs
  set
    delivery_status = v_delivery,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_delivery = 'sent'
          then 'In-app notification recorded.'
        when v_delivery = 'not_configured'
          then 'In-app task notifications are disabled.'
        else 'Task completed, but notification delivery failed.'
      end
    )
  where id = p_run_id;

  return query
  select v_next, v_delivery;
end;
$$;

create or replace function public.settle_scheduled_task_failure(
  p_task_id uuid,
  p_worker_id text,
  p_run_id text,
  p_failure_type text,
  p_safe_error text,
  p_retryable boolean
)
returns table (
  retry_at timestamptz,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_owner uuid;
  v_retry_at timestamptz;
  v_should_retry boolean;
  v_error text;
  v_preview text;
  v_notify boolean := true;
  v_delivery text := 'pending';
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden'
      using errcode = '42501';
  end if;

  if p_failure_type not in (
    'temporary',
    'permanent',
    'authorization',
    'timeout'
  ) then
    raise exception 'invalid_failure_type'
      using errcode = '22023';
  end if;

  select user_id into v_owner from public.scheduled_tasks where id=p_task_id;
  if v_owner is null then raise exception 'scheduled_execution_lease_not_owned' using errcode='55000'; end if;
  perform kova_private.lock_scheduled_task_account(v_owner);
  select *
  into v_task
  from public.scheduled_tasks
  where id = p_task_id
    and status = 'running'
    and worker_id = p_worker_id
    and lease_expires_at > now()
  for update;

  if not found then
    raise exception 'scheduled_execution_lease_not_owned'
      using errcode = '55000';
  end if;

  v_error := left(
    coalesce(
      nullif(trim(p_safe_error), ''),
      'Scheduled task failed.'
    ),
    500
  );

  v_should_retry :=
    p_retryable
    and p_failure_type in ('temporary', 'timeout')
    and v_task.execution_attempts < 4;

  if v_should_retry then
    v_retry_at :=
      now() +
      case v_task.execution_attempts
        when 1 then interval '1 minute'
        when 2 then interval '5 minutes'
        else interval '15 minutes'
      end;
  else
    v_retry_at := null;
  end if;

  if v_retry_at is null then update public.scheduled_task_events set state='failed' where id=v_task.current_event_id; end if;

  v_preview := left(
    regexp_replace(v_error, E'[\\r\\n\\t]+', ' ', 'g'),
    220
  );

  update public.scheduled_tasks
  set
    status = case
      when v_retry_at is null then 'failed'
      else 'scheduled'
    end,
    last_run_at = now(),
    worker_id = null,
    lease_expires_at = null,
    retry_after = v_retry_at,
    last_failure_type = p_failure_type,
    last_error = v_error,
    updated_at = now()
  where id = p_task_id;

  update public.scheduled_task_runs
  set
    status = 'failed',
    completed_at = now(),
    delivery_status = 'pending',
    failure_type = p_failure_type,
    retry_eligible = v_retry_at is not null,
    next_run_at = v_retry_at,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_retry_at is null
          then v_preview
        else left(
          v_preview || ' A bounded automatic retry was scheduled.',
          500
        )
      end
    )
  where id = p_run_id
    and task_id = p_task_id
    and user_id = v_task.user_id;

  if not found then
    raise exception 'scheduled_run_not_owned'
      using errcode = '55000';
  end if;

  select
    coalesce(np.in_app_enabled, true)
    and coalesce((np.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences np
  where np.user_id = v_task.user_id;

  if not found then
    v_notify := true;
  end if;

  if v_notify then
    begin
      insert into public.app_notifications (
        owner_id,
        type,
        title,
        safe_preview,
        action_url,
        source_entity,
        delivery_state
      )
      values (
        v_task.user_id,
        'task_failure',
        left('Task issue: ' || v_task.title, 240),
        case
          when v_retry_at is null then v_preview
          else left(
            v_preview || ' KovaGPT will retry automatically.',
            220
          )
        end,
        '/scheduled-tasks',
        'scheduled_task:' || v_task.id::text,
        'delivered'
      );

      insert into public.notification_deliveries (
        user_id,
        task_run_id,
        channel,
        status,
        preview,
        delivered_at
      )
      values (
        v_task.user_id,
        p_run_id,
        'in_app',
        'sent',
        v_preview,
        now()
      );

      v_delivery := 'sent';
    exception
      when others then
        v_delivery := 'failed';
    end;
  else
    v_delivery := 'not_configured';
  end if;

  update public.scheduled_task_runs
  set
    delivery_status = v_delivery,
    safe_logs = array_append(
      coalesce(safe_logs, '{}'::text[]),
      case
        when v_delivery = 'sent'
          then 'In-app failure notification recorded.'
        when v_delivery = 'not_configured'
          then 'In-app task notifications are disabled.'
        else 'Failure recorded, but notification delivery failed.'
      end
    )
  where id = p_run_id;

  return query
  select v_retry_at, v_delivery;
end;
$$;



create function kova_private.scheduled_task_connection_current(p_user uuid,p_provider text,p_connection text,p_generation text,p_account text,p_scopes text[])
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare current_grant record; consent record;begin
 if exists(select 1 from public.user_preferences where user_id=p_user and settings is not null and settings<>'null'::jsonb and (jsonb_typeof(settings)<>'object' or settings->'lockdown_mode'='true'::jsonb)) then return false; end if;
 if p_scopes is null or cardinality(p_scopes)=0 or p_generation is null or p_account is null then return false; end if;
 if p_provider='gmail' then
  select * into current_grant from public.google_oauth_tokens where id=p_connection::uuid and user_id=p_user and revoked_at is null and not reauthorization_required and identity_verified;
  return coalesce(found and current_grant.google_sub=p_account and current_grant.grant_id::text=p_generation
   and p_scopes<@regexp_split_to_array(current_grant.scopes,'\s+') and 'https://www.googleapis.com/auth/gmail.readonly'=any(p_scopes)
   and (current_grant.expires_at>now() or current_grant.refresh_token is not null),false);
 end if;
 if p_provider not in('slack','github') then return false; end if;
 select * into current_grant from public.integration_linked_accounts where id=p_connection::uuid and owner_id=p_user and provider_id=p_provider
  and status='connected' and deleted_at is null and (token_expires_at is null or token_expires_at>now());
 if not found or current_grant.provider_account_id<>p_account or p_scopes is null or not p_scopes<@current_grant.granted_scopes
  or p_generation<>current_grant.credential_key_version::text||':'||floor(extract(epoch from current_grant.updated_at)*1000)::bigint::text then return false; end if;
 if (p_provider='github' and not 'repo'=any(p_scopes)) or (p_provider='slack' and (not 'channels:history'=any(p_scopes) or not 'channels:read'=any(p_scopes) or ('groups:history'=any(p_scopes) and not 'groups:read'=any(p_scopes)))) then return false; end if;
 select * into consent from public.integration_consents where owner_id=p_user and linked_account_id=current_grant.id order by created_at desc,id desc limit 1;
 if not found or consent.decision<>'granted' or not p_scopes<@consent.scopes then return false; end if;
 -- Legacy workspace UUIDs have no authoritative organization membership binding.
 -- Personal connections are supported; never infer tenant access from policy alone.
 if current_grant.workspace_id is not null then return false; end if;
 return true;
end$$;
revoke all on function kova_private.scheduled_task_connection_current(uuid,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function kova_private.scheduled_task_connection_current(uuid,text,text,text,text,text[]) to service_role;
create function public.validate_scheduled_task_connection_grant(p_user_id uuid,p_grant_id uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$declare g public.scheduled_task_connection_grants%rowtype;begin
 if exists(select 1 from public.account_deletion_fences where user_id=p_user_id) or not kova_private.auth_user_exists(p_user_id) then return false; end if;
 select * into g from public.scheduled_task_connection_grants where id=p_grant_id and user_id=p_user_id and revoked_at is null and expires_at>now();
 if not found then return false; end if;
 return kova_private.scheduled_task_connection_current(g.user_id,g.provider,g.connection_ref,g.connection_generation,g.provider_account_id,g.required_scopes);
end$$;
revoke all on function public.validate_scheduled_task_connection_grant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_scheduled_task_connection_grant(uuid,uuid) to service_role;
create function public.grant_scheduled_task_connection(p_user_id uuid,p_grant_id uuid,p_provider text,p_connection_ref text,p_connection_generation text,p_provider_account_id text,p_scopes text[])
returns uuid language plpgsql security invoker set search_path='' as $$begin
 perform kova_private.lock_scheduled_task_account(p_user_id);
 if not kova_private.scheduled_task_connection_current(p_user_id,p_provider,p_connection_ref,p_connection_generation,p_provider_account_id,p_scopes) then raise exception 'task_connection_unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.scheduled_task_connection_grants where id=p_grant_id and user_id=p_user_id and provider=p_provider and connection_ref=p_connection_ref and connection_generation=p_connection_generation and revoked_at is null and expires_at>now()) then return p_grant_id; end if;
 if (select count(*) from public.scheduled_task_connection_grants where user_id=p_user_id and revoked_at is null and expires_at>now())>=20 or (select count(*) from public.scheduled_task_connection_grants where user_id=p_user_id)>=1000 then raise exception 'task_connection_capacity' using errcode='54000'; end if;
 insert into public.scheduled_task_connection_grants(id,user_id,provider,connection_ref,connection_generation,provider_account_id,required_scopes)
 values(p_grant_id,p_user_id,p_provider,p_connection_ref,p_connection_generation,p_provider_account_id,p_scopes);
 insert into public.account_audit_entries(user_id,event_type,safe_description,actor_id,target_id,result,metadata)
 values(p_user_id,'scheduled_task_change','Granted task read access',p_user_id,p_grant_id::text,'success',jsonb_build_object('provider',p_provider));
 return p_grant_id;
end$$;
create function public.revoke_scheduled_task_connection(p_user_id uuid,p_grant_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$begin
 perform kova_private.lock_scheduled_task_account(p_user_id);
 update public.scheduled_task_connection_grants set revoked_at=now() where id=p_grant_id and user_id=p_user_id and revoked_at is null;
 if not found then return false; end if;
 update public.scheduled_tasks t set status='paused',automation_consent_at=null,worker_id=null,lease_expires_at=null,revision=revision+1,last_failure_type='authorization',last_error='Task connection access was revoked.'
 where user_id=p_user_id and exists(select 1 from jsonb_array_elements(t.context_refs||t.event_triggers) ref where ref->>'grantId'=p_grant_id::text);
 update public.scheduled_task_events set state='canceled' where grant_id=p_grant_id and state in('pending','running');
 update public.scheduled_task_runs r set status='canceled',completed_at=now() where r.user_id=p_user_id and r.status='running' and exists(select 1 from public.scheduled_tasks t where t.id=r.task_id and t.status='paused');
 insert into public.account_audit_entries(user_id,event_type,safe_description,actor_id,target_id,result)
 values(p_user_id,'scheduled_task_change','Revoked task read access',p_user_id,p_grant_id::text,'success');
 return true;
end$$;
revoke all on function public.grant_scheduled_task_connection(uuid,uuid,text,text,text,text,text[]),public.revoke_scheduled_task_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.grant_scheduled_task_connection(uuid,uuid,text,text,text,text,text[]),public.revoke_scheduled_task_connection(uuid,uuid) to service_role;

-- Inputs are normalized by a signature-verified provider adapter, which also
-- checks the exact connected account's access to the resource before this RPC.
create function public.admit_scheduled_task_event(p_grant_id uuid,p_event_key text,p_event jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare g public.scheduled_task_connection_grants%rowtype; task public.scheduled_tasks%rowtype; trigger jsonb; admitted integer:=0; inserted integer; occurred timestamptz;begin
 if char_length(coalesce(p_event_key,'')) not between 1 and 250 or jsonb_typeof(p_event) is distinct from 'object' or pg_column_size(p_event)>16384 then raise exception 'task_event_invalid' using errcode='22023'; end if;
 begin occurred:=(p_event->>'occurredAt')::timestamptz; exception when others then raise exception 'task_event_invalid' using errcode='22023'; end;
 if occurred is null or not isfinite(occurred) or occurred>now()+interval '5 minutes' then raise exception 'task_event_invalid' using errcode='22023'; end if;
 select * into g from public.scheduled_task_connection_grants where id=p_grant_id and revoked_at is null and expires_at>now();
 if not found then raise exception 'task_connection_unavailable' using errcode='42501'; end if;
 perform kova_private.lock_scheduled_task_account(g.user_id);
 select * into g from public.scheduled_task_connection_grants where id=p_grant_id and revoked_at is null and expires_at>now() for update;
 if not found or not kova_private.scheduled_task_connection_current(g.user_id,g.provider,g.connection_ref,g.connection_generation,g.provider_account_id,g.required_scopes) then raise exception 'task_connection_unavailable' using errcode='42501'; end if;
 if occurred<g.granted_at then return 0; end if;
 if not public.scheduled_task_event_grant_ready(g.id) then raise exception 'task_events_unavailable' using errcode='55000'; end if;
 if not exists(select 1 from public.scheduled_task_runtime where id and enabled and g.provider=any(enabled_event_providers) and heartbeat_at>now()-interval '5 minutes') then raise exception 'task_events_unavailable' using errcode='55000'; end if;
 if public.effective_user_plan_tier(g.user_id) not in('plus','pro') then raise exception 'task_plan_required' using errcode='42501'; end if;
 for task in select * from public.scheduled_tasks where user_id=g.user_id and trigger_mode='event' and status in('scheduled','running') and automation_consent_at is not null and automation_consent_at<=occurred order by id for update loop
  for trigger in select value from jsonb_array_elements(task.event_triggers) where value->>'grantId'=g.id::text loop
   if trigger->>'provider' is distinct from g.provider or trigger->>'resource' is distinct from p_event->>'resource' then continue; end if;
   if coalesce(trigger->>'author','')<>'' and lower(trigger->>'author') is distinct from lower(p_event->>'author') then continue; end if;
   if coalesce(trigger->>'contains','')<>'' and position(lower(trigger->>'contains') in lower(coalesce(p_event->>'title',''))) =0 then continue; end if;
   if coalesce(trigger->>'label','')<>'' and not coalesce(p_event->'labels','[]') ? (trigger->>'label') then continue; end if;
   if g.provider='slack' and not coalesce((trigger->>'includeReplies')::boolean,false) and coalesce((p_event->>'isReply')::boolean,false) then continue; end if;
   if g.provider='github' and not coalesce(trigger->'activities','["opened","synchronize","closed"]') ? (p_event->>'activity') then continue; end if;
   if not exists(select 1 from public.scheduled_task_events where task_id=task.id and grant_id=g.id and event_key=p_event_key) and ((select count(*) from public.scheduled_task_events where user_id=g.user_id and state in('pending','running'))>=100 or (select count(*) from public.scheduled_task_events where user_id=g.user_id)>=10000) then raise exception 'task_event_capacity' using errcode='54000'; end if;
   insert into public.scheduled_task_events(task_id,user_id,grant_id,event_key,event_data) values(task.id,g.user_id,g.id,p_event_key,p_event) on conflict(task_id,grant_id,event_key) do nothing;
   get diagnostics inserted=row_count;admitted:=admitted+inserted;exit;
  end loop;
 end loop;
 return admitted;
end$$;
revoke all on function public.admit_scheduled_task_event(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admit_scheduled_task_event(uuid,text,jsonb) to service_role;

create function public.scheduled_task_check_execution(p_task_id uuid,p_worker_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare task public.scheduled_tasks%rowtype; g public.scheduled_task_connection_grants%rowtype;begin
 select * into task from public.scheduled_tasks where id=p_task_id;
 if not found then return false; end if;
 perform kova_private.lock_scheduled_task_account(task.user_id);
 if not exists(select 1 from public.scheduled_tasks where id=p_task_id and status='running' and worker_id=p_worker_id and lease_expires_at>now() and automation_consent_at is not null)
  or public.effective_user_plan_tier(task.user_id) not in('plus','pro') or not public.scheduled_task_runtime_ready(task.execution_policy_version) then return false; end if;
 perform kova_private.validate_scheduled_task_context(task.user_id,task.context_refs,task.event_triggers);
 for g in select * from public.scheduled_task_connection_grants where user_id=task.user_id and exists(select 1 from jsonb_array_elements(task.context_refs||task.event_triggers) ref where ref->>'grantId'=id::text) loop
  if g.revoked_at is not null or g.expires_at<=now() or not kova_private.scheduled_task_connection_current(g.user_id,g.provider,g.connection_ref,g.connection_generation,g.provider_account_id,g.required_scopes) then return false; end if;
 end loop;
 return true;
end$$;
revoke all on function public.scheduled_task_check_execution(uuid,text) from public,anon,authenticated;
grant execute on function public.scheduled_task_check_execution(uuid,text) to service_role;

create function public.purge_scheduled_task_ephemera(p_before timestamptz,p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$declare n integer;total integer:=0;begin
 if p_before is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'task_cleanup_invalid' using errcode='22023'; end if;
 with old as(select user_id,mutation_id from public.scheduled_task_mutation_receipts where created_at<least(p_before,now()-interval '8 days') order by created_at limit p_limit for update skip locked)
 delete from public.scheduled_task_mutation_receipts r using old o where r.user_id=o.user_id and r.mutation_id=o.mutation_id;
 get diagnostics n=row_count;total:=total+n;
 -- Keep event IDs as deduplication tombstones; discard their private payload.
 with old as(select id from public.scheduled_task_events where state in('completed','failed','canceled') and event_data<>'{}'::jsonb and received_at<least(p_before,now()-interval '7 days') order by received_at,id limit p_limit for update skip locked)
 update public.scheduled_task_events e set event_data='{}'::jsonb from old where e.id=old.id;
 get diagnostics n=row_count;return total+n;
end$$;
revoke all on function public.purge_scheduled_task_ephemera(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.purge_scheduled_task_ephemera(timestamptz,integer) to service_role;

-- Saved context is bounded and authorized again in the same transaction as its
-- read; connected bytes are retrieved only by the exact current grant adapter.
create function public.read_scheduled_task_saved_context(p_task_id uuid,p_worker_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare task public.scheduled_tasks%rowtype; ref jsonb; body text; result jsonb:='[]'; remaining integer:=24000;begin
 if not public.scheduled_task_check_execution(p_task_id,p_worker_id) then raise exception 'task_authorization_changed' using errcode='42501'; end if;
 select * into task from public.scheduled_tasks where id=p_task_id;
 for ref in select value from jsonb_array_elements(task.context_refs) loop
  body:=null;
  if ref->>'kind'='snapshot' then body:=ref->>'text';
  elsif ref->>'kind'='library' then select content_text into body from public.user_library_items where id=(ref->>'id')::uuid and user_id=task.user_id;
  elsif ref->>'kind'='project_file' then
   select string_agg(content,E'\n' order by chunk_index) into body from (select left(content,12000) content,chunk_index from public.project_file_chunks where file_id=(ref->>'id')::uuid and project_id=(ref->>'projectId')::uuid order by chunk_index limit 12) chunks;
  end if;
  if ref->>'kind'<>'connected' then
   if body is null or body='' then raise exception 'task_context_unavailable' using errcode='42501'; end if;
   if char_length(body)>remaining then raise exception 'task_context_capacity' using errcode='54000'; end if;
   result:=result||jsonb_build_array(jsonb_build_object('kind',ref->>'kind','text',body));remaining:=remaining-char_length(body);
  end if;
 end loop;
 return result;
end$$;
revoke all on function public.read_scheduled_task_saved_context(uuid,text) from public,anon,authenticated;
grant execute on function public.read_scheduled_task_saved_context(uuid,text) to service_role;


create function public.list_scheduled_task_context_options(p_user_id uuid,p_kind text,p_after uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$declare result jsonb;begin
 if exists(select 1 from public.account_deletion_fences where user_id=p_user_id) or not kova_private.auth_user_exists(p_user_id) then raise exception 'task_account_unavailable' using errcode='42501'; end if;
 if p_kind='library' then
  with available as(select id,title label from public.user_library_items where user_id=p_user_id and coalesce(content_text,'')<>'' and (p_after is null or id>p_after) order by id limit 51),
  page as(select * from available order by id limit 50)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page p),'[]'),'nextCursor',case when (select count(*) from available)>50 then (select id from page order by id desc limit 1) else null end) into result;
 elsif p_kind='project_file' then
  with available as(select f.id,f.project_id "projectId",p.name||' / '||f.name label from public.project_files f join public.projects p on p.id=f.project_id
   where f.status='ready' and f.account_cleanup_user_id is null and p.deletion_requested_at is null and public.is_project_member(p_user_id,p.id)
    and (p_after is null or f.id>p_after) and exists(select 1 from public.project_file_chunks where file_id=f.id) order by f.id limit 51),
  page as(select * from available order by id limit 50)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page p),'[]'),'nextCursor',case when (select count(*) from available)>50 then (select id from page order by id desc limit 1) else null end) into result;
 else raise exception 'task_context_invalid' using errcode='22023'; end if;
 return result;
end$$;
revoke all on function public.list_scheduled_task_context_options(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.list_scheduled_task_context_options(uuid,text,uuid) to service_role;

-- User-portable metadata deliberately excludes OAuth subjects, grant/connection
-- generations, webhook cursors, delivery IDs and mutation receipt fingerprints.
create view public.scheduled_task_account_export with(security_invoker=true) as
 select user_id,'approval:'||md5(id::text) id,'connection_approval'::text kind,
  jsonb_build_object('provider',provider,'approvedScopes',required_scopes,'grantedAt',granted_at,'expiresAt',expires_at,'revokedAt',revoked_at) data
 from public.scheduled_task_connection_grants
 union all
 select user_id,'event:'||id::text,'event',jsonb_build_object('taskId',task_id,'state',state,'receivedAt',received_at,'scheduledFor',scheduled_for,
  'source',jsonb_build_object('occurredAt',event_data->'occurredAt','resource',event_data->'resource','author',event_data->'author','title',event_data->'title','text',event_data->'text','labels',event_data->'labels','activity',event_data->'activity','isReply',event_data->'isReply'))
 from public.scheduled_task_events
 union all
 select owner_id,'copy-sent:'||id::text,'copy_offer',jsonb_build_object('direction','sent','title',title,'prompt',prompt,'repeat',repeat,'timezone',timezone,'localTime',schedule_local,'state',state,'createdAt',created_at,'expiresAt',expires_at)
 from public.scheduled_task_copy_offers
 union all
 select recipient_id,'copy-received:'||id::text,'copy_offer',jsonb_build_object('direction','received','title',title,'prompt',prompt,'repeat',repeat,'timezone',timezone,'localTime',schedule_local,'state',state,'createdAt',created_at,'expiresAt',expires_at,'copiedTaskId',copied_task_id)
 from public.scheduled_task_copy_offers;
revoke all on public.scheduled_task_account_export from public,anon,authenticated;
grant select on public.scheduled_task_account_export to service_role;

revoke execute on function public.complete_scheduled_task_execution(uuid,text,timestamptz,text) from service_role;
revoke execute on function public.fail_scheduled_task_execution(uuid,text,text,text,boolean) from service_role;
commit;
