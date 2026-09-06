create or replace function public.kova_can_pin_source(p_source_type text, p_source_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_source_type = 'library' then exists (
      select 1 from public.user_library_items li
      where li.id = p_source_id and li.user_id = (select auth.uid())
    )
    when p_source_type = 'project_file' then p_project_id is not null
      and (select auth.uid()) is not null
      and public.is_project_member(p_project_id, (select auth.uid()))
      and exists (
        select 1 from public.project_files pf
        where pf.id = p_source_id and pf.project_id = p_project_id
      )
    else false
  end;
$$;

revoke all on function public.kova_can_pin_source(text, uuid, uuid) from public;
revoke all on function public.kova_can_pin_source(text, uuid, uuid) from anon;
grant execute on function public.kova_can_pin_source(text, uuid, uuid) to authenticated;
grant execute on function public.kova_can_pin_source(text, uuid, uuid) to service_role;