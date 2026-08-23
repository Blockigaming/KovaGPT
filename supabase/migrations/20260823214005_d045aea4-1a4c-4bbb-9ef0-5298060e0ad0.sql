-- Replace the elevated pinned-file permission helper with an invoker-rights
-- version. Existing project_files RLS ("files_select_members") already limits
-- visibility to project members, so the helper needs no elevated rights.
drop policy if exists "chat_pinned_files_owner_insert" on public.chat_pinned_files;
drop policy if exists "chat_pinned_files_owner_update" on public.chat_pinned_files;

drop function if exists public.kova_can_use_project_file(uuid);

create or replace function public.kova_can_use_project_file(p_file_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select p_file_id is null or exists (
    select 1 from public.project_files pf where pf.id = p_file_id
  );
$$;

revoke all on function public.kova_can_use_project_file(uuid) from public;
revoke all on function public.kova_can_use_project_file(uuid) from anon;
grant execute on function public.kova_can_use_project_file(uuid) to authenticated;
grant execute on function public.kova_can_use_project_file(uuid) to service_role;

create policy "chat_pinned_files_owner_insert" on public.chat_pinned_files
  for insert to authenticated
  with check (auth.uid() = user_id and public.kova_can_use_project_file(file_id));

create policy "chat_pinned_files_owner_update" on public.chat_pinned_files
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.kova_can_use_project_file(file_id));

revoke all on function public.kova_set_updated_at() from public;
revoke all on function public.kova_set_updated_at() from anon;