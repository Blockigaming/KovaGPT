-- Private browser bodies, credentials and screenshots never enter this table.
create table public.work_browser_sessions (
 id uuid primary key,
 owner_id uuid not null,
 run_id uuid not null,
 mode text not null check(mode in ('takeover','agent','closed')),
 sequence bigint not null default 1 check(sequence between 1 and 10000),
 operation text not null,
 last_approval_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp() + interval '5 minutes',
 foreign key(run_id,owner_id) references public.work_execution_runs(id,owner_id) on delete cascade,
 check(expires_at <= created_at + interval '5 minutes')
);
create unique index work_browser_one_live_run on public.work_browser_sessions(run_id) where mode <> 'closed';
alter table public.work_browser_sessions enable row level security;
create policy work_browser_owner_read on public.work_browser_sessions for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.work_browser_sessions from public,anon,authenticated;
grant select on public.work_browser_sessions to authenticated;
grant select,insert,update,delete on public.work_browser_sessions to service_role;

create function kova_private.lock_work_browser_run(p_owner uuid,p_run uuid,p_revoking boolean default false)
returns public.work_execution_runs language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; prefs jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) or (not p_revoking and exists(select 1 from public.account_deletion_fences where user_id=p_owner)) then
   raise exception 'work_browser_owner_unavailable' using errcode='42501'; end if;
 select settings into prefs from public.user_preferences where user_id=p_owner;
 if not p_revoking and prefs is not null and (jsonb_typeof(prefs)<>'object' or coalesce(prefs->>'lockdown_mode','false')<>'false') then
   raise exception 'work_browser_lockdown_active' using errcode='42501'; end if;
 select * into r from public.work_execution_runs where id=p_run and owner_id=p_owner for update;
 if not found then raise exception 'work_browser_not_found' using errcode='42501'; end if;
 return r;
end $$;
revoke all on function kova_private.lock_work_browser_run(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function kova_private.lock_work_browser_run(uuid,uuid,boolean) to service_role;

create function public.admit_work_browser_owner(p_owner uuid,p_run uuid,p_session uuid,p_run_revision bigint,p_sequence bigint,p_operation text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,p_operation='close');
 if r.revision is distinct from p_run_revision then raise exception 'work_browser_revision_conflict' using errcode='40001'; end if;
 if p_session is null or p_operation is null or p_operation not in ('open','navigate','snapshot','click','fill','press','scroll','takeover','release','close') then
   raise exception 'work_browser_operation_invalid' using errcode='22023'; end if;
 if p_operation<>'close' and (r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started') then
   raise exception 'work_browser_pause_required' using errcode='42501'; end if;
 if p_operation='open' then
   if p_sequence is distinct from 0 then raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   update public.work_browser_sessions set mode='closed' where run_id=p_run and expires_at<=clock_timestamp();
   if (select count(*) from public.work_browser_sessions where owner_id=p_owner)>=10000 then
     raise exception 'work_browser_limit' using errcode='54000'; end if;
   insert into public.work_browser_sessions(id,owner_id,run_id,mode,operation) values(p_session,p_owner,p_run,'takeover',p_operation) returning * into s;
 else
   select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
   if not found or s.sequence is distinct from p_sequence or s.mode='closed' or (p_operation<>'close' and s.expires_at<=clock_timestamp()) then
     raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   if p_operation not in ('close','takeover') and s.mode<>'takeover' then
     raise exception 'work_browser_takeover_required' using errcode='42501'; end if;
   update public.work_browser_sessions set sequence=sequence+1,operation=p_operation,
     mode=case when p_operation='takeover' then 'takeover' else mode end
     where id=p_session returning * into s;
 end if;
 return jsonb_build_object('sessionId',s.id,'runId',s.run_id,'sequence',s.sequence,'mode',s.mode,
   'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;
revoke all on function public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text) to service_role;

create function public.finish_work_browser_owner(p_owner uuid,p_run uuid,p_session uuid,p_sequence bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,exists(select 1 from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run and operation='close' and sequence=p_sequence));
 select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
 if not found or s.sequence<>p_sequence then return false; end if;
 if s.operation='release' then
   if r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started' then return false; end if;
   update public.work_browser_sessions set mode='agent' where id=p_session;
 elsif s.operation='close' then update public.work_browser_sessions set mode='closed' where id=p_session;
 end if;
 return true;
end $$;
revoke all on function public.finish_work_browser_owner(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.finish_work_browser_owner(uuid,uuid,uuid,bigint) to service_role;

create function public.authorize_work_browser(p_owner uuid,p_run uuid,p_session uuid,p_runner uuid,p_build text,p_actor text,p_phase text,p_sequence bigint default null,p_epoch bigint default null,p_step uuid default null,p_hash text default null,p_approval uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions; t numeric:=extract(epoch from clock_timestamp())*1000;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,p_actor='owner' and p_phase='check' and exists(select 1 from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run and operation='close' and sequence=p_sequence));
 if r.state->>'runnerId' is distinct from p_runner::text or r.state->>'runnerBuild' is distinct from p_build then
   raise exception 'work_browser_runner_denied' using errcode='42501'; end if;
 select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
 if not found or s.mode='closed' or s.expires_at<=clock_timestamp() then raise exception 'work_browser_session_stale' using errcode='42501'; end if;
 if p_actor='owner' then
   if p_phase<>'check' or s.sequence is distinct from p_sequence or
     (s.operation<>'close' and (r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started')) or
     (s.operation<>'close' and s.mode<>'takeover') then raise exception 'work_browser_owner_denied' using errcode='42501'; end if;
 elsif p_actor='agent' then
   if s.mode<>'agent' or r.status<>'running' or (r.state->>'epoch')::bigint is distinct from p_epoch or
     r.state#>>'{step,id}' is distinct from p_step::text or r.state#>>'{step,inputHash}' is distinct from p_hash or
     coalesce((r.state#>>'{lease,expiresAt}')::numeric,0)<=t or coalesce((r.state->>'deadline')::numeric,0)<=t then
       raise exception 'work_browser_agent_denied' using errcode='42501'; end if;
   if p_phase<>'catalog' then
     if r.state#>>'{approval,id}' is distinct from p_approval::text or r.state#>>'{approval,status}' is distinct from 'consumed' or
       r.state#>>'{approval,action}' is distinct from 'browser_interact' or
       r.state#>>'{effect,id}' is distinct from p_approval::text or r.state#>>'{effect,status}' is distinct from 'started' or
       coalesce((r.state#>>'{approval,expiresAt}')::numeric,0)<=t or
       (r.state#>>'{approval,canonicalInput}')::jsonb->>'sessionId' is distinct from p_session::text then
       raise exception 'work_browser_approval_required' using errcode='42501'; end if;
   end if;
   if p_phase='admit_agent' then
     if s.last_approval_id is distinct from p_approval then
       update public.work_browser_sessions set sequence=sequence+1,last_approval_id=p_approval,operation='agent' where id=p_session returning * into s;
     end if;
   elsif p_phase='check' then
     if s.last_approval_id is distinct from p_approval or s.sequence is distinct from p_sequence then
       raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   elsif p_phase<>'catalog' then raise exception 'work_browser_phase_invalid' using errcode='22023'; end if;
 else raise exception 'work_browser_actor_invalid' using errcode='22023'; end if;
 return jsonb_build_object('allowed',true,'sequence',s.sequence,'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;
revoke all on function public.authorize_work_browser(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.authorize_work_browser(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,uuid) to service_role;

-- Taking over and beginning a model step share the same account lock. A UI-only
-- disabled Resume button would leave a cross-tab/server race.
create function kova_private.guard_work_browser_takeover() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text,20260903204500));
 if new.status in ('queued','running') and exists(select 1 from public.work_browser_sessions
   where run_id=new.id and mode='takeover' and expires_at>clock_timestamp()) then
   raise exception 'work_browser_takeover_active' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function kova_private.guard_work_browser_takeover() from public,anon,authenticated;
grant execute on function kova_private.guard_work_browser_takeover() to service_role;
create trigger guard_work_browser_takeover before update on public.work_execution_runs for each row execute function kova_private.guard_work_browser_takeover();
