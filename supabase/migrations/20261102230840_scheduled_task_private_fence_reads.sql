-- Restore the existing owner-only read policy without exposing deletion fences.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

do $guard$
declare
  expression text;
begin
  select regexp_replace(pg_get_expr(p.polqual,p.polrelid),'\s+','','g') into expression
  from pg_policy p
  where p.polrelid='public.scheduled_tasks'::regclass
    and p.polname='scheduled_tasks_current_owner' and p.polcmd='r'
    and p.polpermissive and p.polwithcheck is null
    and p.polroles=array[(select oid from pg_roles where rolname='authenticated')];
  if expression is distinct from
    '((user_id=(SELECTauth.uid()ASuid))AND(NOT(EXISTS(SELECT1FROMaccount_deletion_fencesfWHERE(f.user_id=(SELECTauth.uid()ASuid))))))'
  then raise exception 'scheduled_task_read_policy_changed'; end if;
  if has_table_privilege('authenticated','public.account_deletion_fences','SELECT')
     or has_table_privilege('anon','public.account_deletion_fences','SELECT')
  then raise exception 'deletion_fence_table_access_unexpected'; end if;
end $guard$;

-- This private, argument-free helper can reveal only the caller's own status.
-- Its definer privilege is needed to read the server-only fence table. It
-- cannot choose another account, return fence rows, or modify any data.
create function kova_private.scheduled_task_reader_is_active()
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare caller uuid := auth.uid();
begin
  return caller is not null and not exists(
    select 1 from public.account_deletion_fences where user_id=caller
  );
end $function$;
revoke all on function kova_private.scheduled_task_reader_is_active()
  from public,anon,authenticated,service_role;
grant execute on function kova_private.scheduled_task_reader_is_active() to authenticated;

alter policy scheduled_tasks_current_owner on public.scheduled_tasks
  using(user_id=(select auth.uid()) and (select kova_private.scheduled_task_reader_is_active()));
-- Existing restrictive session guards and all table privileges are unchanged.
commit;
