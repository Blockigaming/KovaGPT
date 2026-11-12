begin;

create function kova_private.notify_project_member_role_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is distinct from old.project_id
     or new.user_id is distinct from old.user_id
     or old.role not in ('editor', 'viewer')
     or new.role not in ('editor', 'viewer')
     or not kova_private.can_receive_project_notice(new.user_id) then
    return new;
  end if;

  insert into public.app_notifications(owner_id, type, title, safe_preview, action_url, source_entity)
  values (
    new.user_id, 'project_role_change', 'Your project permissions changed',
    'Open Projects to review your access.', '/projects/' || new.project_id::text,
    'project-member-role:' || new.project_id::text || ':' || new.user_id::text
  );
  return new;
end
$$;

revoke all on function kova_private.notify_project_member_role_change() from public, anon, authenticated;

create trigger notify_project_member_role_change
after update of role on public.project_members
for each row when (old.role is distinct from new.role)
execute function kova_private.notify_project_member_role_change();

commit;
