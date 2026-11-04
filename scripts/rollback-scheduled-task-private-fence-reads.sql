-- Metadata-only rollback; restores the prior read policy, including its fault.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
alter policy scheduled_tasks_current_owner on public.scheduled_tasks
  using(user_id=(select auth.uid()) and not exists(
    select 1 from public.account_deletion_fences f where f.user_id=(select auth.uid())
  ));
drop function kova_private.scheduled_task_reader_is_active();
commit;
