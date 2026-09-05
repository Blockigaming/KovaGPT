-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

begin;

create unique index if not exists chat_message_versions_one_accepted
  on public.chat_message_versions(owner_id, chat_id, message_id)
  where accepted;

create or replace function public.validate_chat_branch_lineage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.parent_branch_id is not null and not exists (
    select 1 from public.chat_branches p
    where p.id = new.parent_branch_id
      and p.owner_id = new.owner_id
      and p.chat_id = new.chat_id
  ) then
    raise exception 'invalid_parent_branch';
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_chat_branch_lineage() from public, anon, authenticated;

drop trigger if exists trg_validate_chat_branch_lineage on public.chat_branches;
create trigger trg_validate_chat_branch_lineage
before insert or update of parent_branch_id, owner_id, chat_id
on public.chat_branches
for each row execute function public.validate_chat_branch_lineage();

drop policy if exists chat_pinned_files_owner_update on public.chat_pinned_files;
create policy chat_pinned_files_owner_update on public.chat_pinned_files
for update to authenticated
using (auth.uid() = owner_id)
with check (
  auth.uid() = owner_id and (
    (source_type = 'library' and exists (
      select 1 from public.user_library_items u
      where u.id = source_id and u.user_id = auth.uid()
    ))
    or
    (source_type = 'project_file' and exists (
      select 1
      from public.project_files pf
      join public.projects p on p.id = pf.project_id
      left join public.project_members pm
        on pm.project_id = p.id and pm.user_id = auth.uid()
      where pf.id = source_id
        and (p.owner_id = auth.uid() or pm.user_id = auth.uid())
    ))
  )
);

create or replace function public.set_active_chat_branch(p_chat_id text, p_branch_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not exists (
    select 1 from public.chat_branches
    where id = p_branch_id
      and owner_id = auth.uid()
      and chat_id = p_chat_id
  ) then
    raise exception 'branch_not_found';
  end if;

  update public.chat_branches
  set active = (id = p_branch_id), updated_at = now()
  where owner_id = auth.uid() and chat_id = p_chat_id;
end;
$$;

revoke all on function public.set_active_chat_branch(text, uuid) from public, anon;
grant execute on function public.set_active_chat_branch(text, uuid) to authenticated;

commit;
;
