-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Ensure direct client inserts/updates cannot attach a version to a branch
-- owned by a different user or belonging to another chat.
create or replace function public.validate_chat_message_version_branch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.branch_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chat_branches branch
    where branch.id = new.branch_id
      and branch.owner_id = new.owner_id
      and branch.chat_id = new.chat_id
  ) then
    raise exception 'invalid_chat_message_version_branch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_chat_message_version_branch() from public;
revoke all on function public.validate_chat_message_version_branch() from anon;
revoke all on function public.validate_chat_message_version_branch() from authenticated;
grant execute on function public.validate_chat_message_version_branch() to service_role;

drop trigger if exists trg_validate_chat_message_version_branch
  on public.chat_message_versions;
create trigger trg_validate_chat_message_version_branch
before insert or update of branch_id, owner_id, chat_id
on public.chat_message_versions
for each row
execute function public.validate_chat_message_version_branch();
;
