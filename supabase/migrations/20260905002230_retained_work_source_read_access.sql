-- A proved saved Work source outlives its original Project metadata. This
-- helper does not authorize a caller-written storage_reference by itself.
-- source_access is private and populated only after independent provenance,
-- membership, immutable publication, or Storage ownership has been verified.
create or replace function kova_private.can_read_retained_work_source(p_storage_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and p_storage_path is not null
    and char_length(p_storage_path) <= 1024
    and p_storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
    and p_storage_path !~ '(^|/)\.\.?(/|$)'
    and p_storage_path not like '%/.uploads/%'
    and not exists (select 1 from public.project_storage_source_retirements r where r.storage_path=p_storage_path)
    and not exists (select 1 from public.account_deletion_fences f where f.user_id=(select auth.uid()))
    and exists (
      select 1 from public.project_storage_source_access a
      join public.agent_deliverables d on d.owner_id=a.principal_id
        and d.storage_reference='project-files:'||a.storage_path
      where a.storage_path=p_storage_path and a.principal_id=(select auth.uid())
        and d.status is distinct from 'deleted'
    );
$$;
revoke all on function kova_private.can_read_retained_work_source(text) from public,anon,authenticated;
grant execute on function kova_private.can_read_retained_work_source(text) to authenticated;
-- kova_private usage is already explicitly granted in the prerequisite
-- security reconciliation. No table or Auth-schema read grants are added.
create policy project_files_retained_work_read on storage.objects
for select to authenticated
using (bucket_id='project-files' and kova_private.can_read_retained_work_source(name));
