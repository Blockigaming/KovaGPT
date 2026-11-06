-- Kova browser sessions have NO maximum age. Only a 15-minute idle lease.
-- Renew the lease exclusively on authenticated OWNER commands or an approved
-- new AGENT action; catalog/status checks must never keep a browser alive.
-- This migration retains the existing permissions, account locks, run/approval
-- checks, sequence checks and session ownership restrictions.
begin;

do $migration$
declare old_constraint text;
begin
  select c.conname into strict old_constraint
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.work_browser_sessions'::regclass
     and c.contype = 'c'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%expires_at%'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%created_at%';
  execute pg_catalog.format('alter table public.work_browser_sessions drop constraint %I', old_constraint);
exception
  when no_data_found then raise exception 'work_browser_old_age_limit_missing';
  when too_many_rows then raise exception 'work_browser_age_limit_ambiguous';
end
$migration$;

alter table public.work_browser_sessions
  alter column expires_at set default (statement_timestamp() + interval '15 minutes');

-- Keep currently active sessions alive during a coordinated runner rollout.
update public.work_browser_sessions
   set expires_at = statement_timestamp() + interval '15 minutes'
 where mode <> 'closed' and expires_at > statement_timestamp();

create or replace function public.admit_work_browser_owner(p_owner uuid,p_run uuid,p_session uuid,p_run_revision bigint,p_sequence bigint,p_operation text)
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
     mode=case when p_operation='takeover' then 'takeover' else mode end,
     expires_at=case when p_operation='close' then expires_at else statement_timestamp() + interval '15 minutes' end
     where id=p_session returning * into s;
 end if;
 return jsonb_build_object('sessionId',s.id,'runId',s.run_id,'sequence',s.sequence,'mode',s.mode,
   'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;

create or replace function public.authorize_work_browser(p_owner uuid,p_run uuid,p_session uuid,p_runner uuid,p_build text,p_actor text,p_phase text,p_sequence bigint default null,p_epoch bigint default null,p_step uuid default null,p_hash text default null,p_approval uuid default null)
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
       update public.work_browser_sessions set sequence=sequence+1,last_approval_id=p_approval,operation='agent',expires_at=statement_timestamp() + interval '15 minutes' where id=p_session returning * into s;
     end if;
   elsif p_phase='check' then
     if s.last_approval_id is distinct from p_approval or s.sequence is distinct from p_sequence then
       raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   elsif p_phase<>'catalog' then raise exception 'work_browser_phase_invalid' using errcode='22023'; end if;
 else raise exception 'work_browser_actor_invalid' using errcode='22023'; end if;
 return jsonb_build_object('allowed',true,'sequence',s.sequence,'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;

-- Old function grants persist across CREATE OR REPLACE and are not widened.
commit;
