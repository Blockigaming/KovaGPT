-- Resolve the actionable Supabase Security Advisor findings without changing
-- the public RPC contract. Privileged implementations live in an unexposed
-- schema; public entry points are SECURITY INVOKER facades. Functions whose
-- tables already have complete owner-scoped RLS can run as invoker directly.

create schema if not exists kova_private;
revoke all on schema kova_private from public, anon;
grant usage on schema kova_private to authenticated, service_role;

-- These helpers and mutations intentionally bypass recursive or restrictive
-- RLS. Moving the existing function object preserves policy dependencies.
alter function public.accept_project_invite(uuid) set schema kova_private;
alter function public.can_edit_project(uuid, uuid) set schema kova_private;
alter function public.control_agent_job(uuid, text) set schema kova_private;
alter function public.decide_agent_approval(uuid, text, jsonb) set schema kova_private;
alter function public.decline_project_invite(uuid) set schema kova_private;
alter function public.disconnect_github_account(uuid, boolean) set schema kova_private;
alter function public.family_owner_of(uuid) set schema kova_private;
alter function public.is_family_member(uuid, uuid) set schema kova_private;
alter function public.is_project_member(uuid, uuid) set schema kova_private;

alter function kova_private.accept_project_invite(uuid)
  set search_path to pg_catalog;
alter function kova_private.can_edit_project(uuid, uuid)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.control_agent_job(uuid, text)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.decide_agent_approval(uuid, text, jsonb)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.decline_project_invite(uuid)
  set search_path to pg_catalog;
alter function kova_private.disconnect_github_account(uuid, boolean)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.family_owner_of(uuid)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.is_family_member(uuid, uuid)
  set search_path to pg_catalog, public, pg_temp;
alter function kova_private.is_project_member(uuid, uuid)
  set search_path to pg_catalog, public, pg_temp;

revoke all on function kova_private.accept_project_invite(uuid) from public, anon;
revoke all on function kova_private.can_edit_project(uuid, uuid) from public, anon;
revoke all on function kova_private.control_agent_job(uuid, text) from public, anon;
revoke all on function kova_private.decide_agent_approval(uuid, text, jsonb) from public, anon;
revoke all on function kova_private.decline_project_invite(uuid) from public, anon;
revoke all on function kova_private.disconnect_github_account(uuid, boolean) from public, anon;
revoke all on function kova_private.family_owner_of(uuid) from public, anon;
revoke all on function kova_private.is_family_member(uuid, uuid) from public, anon;
revoke all on function kova_private.is_project_member(uuid, uuid) from public, anon;

grant execute on function kova_private.accept_project_invite(uuid) to authenticated, service_role;
grant execute on function kova_private.can_edit_project(uuid, uuid) to authenticated, service_role;
grant execute on function kova_private.control_agent_job(uuid, text) to authenticated, service_role;
grant execute on function kova_private.decide_agent_approval(uuid, text, jsonb) to authenticated, service_role;
grant execute on function kova_private.decline_project_invite(uuid) to authenticated, service_role;
grant execute on function kova_private.disconnect_github_account(uuid, boolean) to authenticated, service_role;
grant execute on function kova_private.family_owner_of(uuid) to authenticated, service_role;
grant execute on function kova_private.is_family_member(uuid, uuid) to authenticated, service_role;
grant execute on function kova_private.is_project_member(uuid, uuid) to authenticated, service_role;

create function public.accept_project_invite(_invite_id uuid)
returns uuid
language sql
security invoker
set search_path to pg_catalog
as $$ select kova_private.accept_project_invite(_invite_id) $$;

create function public.can_edit_project(_project_id uuid, _user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path to pg_catalog
as $$ select kova_private.can_edit_project(_project_id, _user_id) $$;

create function public.control_agent_job(p_job_id uuid, p_action text)
returns jsonb
language sql
security invoker
set search_path to pg_catalog
as $$ select kova_private.control_agent_job(p_job_id, p_action) $$;

create function public.decide_agent_approval(
  p_approval_id uuid,
  p_decision text,
  p_edited_request jsonb default null
)
returns void
language sql
security invoker
set search_path to pg_catalog
as $$ select kova_private.decide_agent_approval(p_approval_id, p_decision, p_edited_request) $$;

create function public.decline_project_invite(_invite_id uuid)
returns boolean
language sql
security invoker
set search_path to pg_catalog
as $$ select kova_private.decline_project_invite(_invite_id) $$;

create function public.disconnect_github_account(
  p_account_id uuid,
  p_remove_data boolean default false
)
returns void
language sql
security invoker
set search_path to pg_catalog
as $$ select kova_private.disconnect_github_account(p_account_id, p_remove_data) $$;

create function public.family_owner_of(_user_id uuid)
returns uuid
language sql
stable
security invoker
set search_path to pg_catalog
as $$ select kova_private.family_owner_of(_user_id) $$;

create function public.is_family_member(_user_id uuid, _group_id uuid)
returns boolean
language sql
stable
security invoker
set search_path to pg_catalog
as $$ select kova_private.is_family_member(_user_id, _group_id) $$;

create function public.is_project_member(_project_id uuid, _user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path to pg_catalog
as $$ select kova_private.is_project_member(_project_id, _user_id) $$;

revoke all on function public.accept_project_invite(uuid) from public, anon, authenticated;
revoke all on function public.can_edit_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.control_agent_job(uuid, text) from public, anon, authenticated;
revoke all on function public.decide_agent_approval(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.decline_project_invite(uuid) from public, anon, authenticated;
revoke all on function public.disconnect_github_account(uuid, boolean) from public, anon, authenticated;
revoke all on function public.family_owner_of(uuid) from public, anon, authenticated;
revoke all on function public.is_family_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_project_member(uuid, uuid) from public, anon, authenticated;

grant execute on function public.accept_project_invite(uuid) to authenticated, service_role;
grant execute on function public.can_edit_project(uuid, uuid) to authenticated, service_role;
grant execute on function public.control_agent_job(uuid, text) to authenticated, service_role;
grant execute on function public.decide_agent_approval(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.decline_project_invite(uuid) to authenticated, service_role;
grant execute on function public.disconnect_github_account(uuid, boolean) to authenticated, service_role;
grant execute on function public.family_owner_of(uuid) to authenticated, service_role;
grant execute on function public.is_family_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_project_member(uuid, uuid) to authenticated, service_role;

-- These operations already have complete owner-scoped RLS and table grants.
-- Running them as the caller removes unnecessary privilege escalation.
alter function public.kova_accept_message_version(uuid) security invoker;
alter function public.kova_activate_chat_branch(text, uuid) security invoker;
alter function public.kova_create_chat_branch(
  text, text, uuid, text, text, integer, text[], text, boolean, integer
) security invoker;
-- Production and the replayed source history currently differ in the order of
-- the final selection/acceptance arguments. Harden whichever known overload is
-- present so this migration is safe in both environments.
do $migration$
begin
  if to_regprocedure(
    'public.kova_record_message_version(text,text,text,text,uuid,text,text,boolean,integer,integer,integer)'
  ) is not null then
    execute 'alter function public.kova_record_message_version(text,text,text,text,uuid,text,text,boolean,integer,integer,integer) security invoker';
  end if;

  if to_regprocedure(
    'public.kova_record_message_version(text,text,text,text,uuid,text,text,integer,integer,boolean,integer)'
  ) is not null then
    execute 'alter function public.kova_record_message_version(text,text,text,text,uuid,text,text,integer,integer,boolean,integer) security invoker';
  end if;
end
$migration$;
alter function public.kova_update_chat_branch_messages(uuid, text[], text) security invoker;
alter function public.save_writing_document(uuid, text, text, integer, text) security invoker;
alter function public.user_plan_tier(uuid) security invoker;

-- No application caller exists for this unfinished promotion endpoint. Keep it
-- available to service code while removing the signed-in-user escalation.
revoke all on function public.promote_agent_deliverable(
  uuid, text, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.promote_agent_deliverable(
  uuid, text, uuid, text, text, boolean
) to service_role;
alter function public.promote_agent_deliverable(uuid, text, uuid, text, text, boolean)
  set search_path to pg_catalog, public, pg_temp;

-- project_file_chunks already has member-only SELECT RLS, so similarity search
-- does not need elevated privileges either.
alter function public.match_project_chunks(uuid, public.vector, integer) security invoker;

-- vector is relocatable. ALTER EXTENSION preserves the type/operator OIDs used
-- by existing columns, indexes, and routines, so no data rewrite is required.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension vector set schema extensions;

alter function public.match_project_chunks(uuid, extensions.vector, integer)
  set search_path to pg_catalog, public, extensions, pg_temp;
