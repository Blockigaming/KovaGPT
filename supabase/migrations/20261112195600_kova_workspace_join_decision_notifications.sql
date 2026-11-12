begin;

alter table public.app_notifications drop constraint app_notifications_type_check;
alter table public.app_notifications add constraint app_notifications_type_check
  check (type in (
    'task_result','task_failure','connector_reauth','shared_chat','project_invitation',
    'project_role_change','project_member_joined','billing_issue','usage_threshold',
    'deep_research_complete','file_processing','security_alert',
    'workspace_join_approved','workspace_join_denied'
  ));

-- Inbox clients may acknowledge their own delivery, but only the server may
-- write the decision, recipient, delivery state, or action destination.
revoke insert, update on public.app_notifications from public, anon, authenticated;
grant update (read_at) on public.app_notifications to authenticated;

create function kova_private.notify_workspace_join_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := 'workspace-join-review:' || new.id::text;
begin
  if new.status = 'pending' then
    -- An eligible new request can reuse the original request ID after a denial.
    update public.app_notifications
      set expires_at = now()
      where owner_id = new.requester_id and source_entity = v_source
        and type in ('workspace_join_approved', 'workspace_join_denied') and expires_at is null;
    return new;
  end if;

  if old.status <> 'pending' or new.status not in ('approved', 'denied')
     or new.reviewed_by is null or new.reviewed_at is null
     or new.requester_id is distinct from old.requester_id
     or new.team_id is distinct from old.team_id
     or lower(kova_private.team_verified_email(new.requester_id)) is distinct from new.requester_email
     or exists (select 1 from public.account_deletion_fences f where f.user_id = new.requester_id)
     or exists (
       select 1 from public.notification_preferences p
       where p.user_id = new.requester_id and p.in_app_enabled is not true
     ) then
    return new;
  end if;

  insert into public.app_notifications(owner_id, type, title, safe_preview, action_url, source_entity)
  values (
    new.requester_id,
    case new.status when 'approved' then 'workspace_join_approved' else 'workspace_join_denied' end,
    case new.status when 'approved' then 'Your workspace request was approved'
      else 'Your workspace request was declined' end,
    case new.status when 'approved' then 'You can join after the workspace owner sends an invitation.'
      else 'You can review your request in Settings under Connections.' end,
    '/settings/connections',
    v_source
  );
  return new;
end
$$;

revoke all on function kova_private.notify_workspace_join_decision() from public, anon, authenticated;

create trigger notify_workspace_join_decision
after update of status on public.team_join_requests
for each row when (old.status is distinct from new.status)
execute function kova_private.notify_workspace_join_decision();

commit;
