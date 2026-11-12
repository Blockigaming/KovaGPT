begin;

alter table public.app_notifications drop constraint app_notifications_type_check;
alter table public.app_notifications add constraint app_notifications_type_check
  check (type in (
    'task_result','task_failure','connector_reauth','shared_chat','project_invitation',
    'project_role_change','project_member_joined','billing_issue','usage_threshold',
    'deep_research_complete','file_processing','security_alert'
  ));

create function kova_private.can_receive_project_notice(p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_user is not null
    and public.kova_auth_directory_email(p_user) is not null
    and not exists (select 1 from public.account_deletion_fences f where f.user_id = p_user)
    and not exists (
      select 1 from public.notification_preferences p
      where p.user_id = p_user
        and (p.in_app_enabled is not true or p.categories->>'projects' = 'false')
    )
$$;
revoke all on function kova_private.can_receive_project_notice(uuid) from public, anon, authenticated;

create function kova_private.sync_project_invitation_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_source text := 'project-invite:' || (case when tg_op = 'DELETE' then old.id else new.id end)::text;
begin
  if tg_op = 'DELETE' then
    update public.app_notifications
      set expires_at = now()
      where type = 'project_invitation' and source_entity = v_source and expires_at is null;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending' and lower(btrim(old.email)) = lower(btrim(new.email))
       and new.status = 'pending' then
      return new;
    end if;
    if old.status = 'pending' then
      update public.app_notifications
        set expires_at = now()
        where type = 'project_invitation' and source_entity = v_source and expires_at is null;
    end if;
  end if;
  if new.status <> 'pending' then return new; end if;
  v_recipient := kova_private.verified_auth_user_for_email(new.email);
  if v_recipient is distinct from new.invited_by
     and kova_private.can_receive_project_notice(v_recipient) then
    insert into public.app_notifications(owner_id, type, title, safe_preview, action_url, source_entity)
    values (
      v_recipient, 'project_invitation', 'You have a project invitation',
      'Open Projects to review the invitation.', '/projects', v_source
    );
  end if;
  return new;
end
$$;
revoke all on function kova_private.sync_project_invitation_notice() from public, anon, authenticated;

create trigger sync_project_invitation_notice
after insert or update of status, email or delete on public.project_invites
for each row execute function kova_private.sync_project_invitation_notice();

create or replace function public.accept_project_invite(_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_invite public.project_invites;
  v_owner uuid;
  v_added boolean;
begin
  if v_actor is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  v_email := public.kova_auth_directory_email(v_actor);
  if v_email is null or exists (
    select 1 from public.account_deletion_fences f where f.user_id = v_actor
  ) then raise exception 'verified_email_required' using errcode = '42501'; end if;

  select * into v_invite from public.project_invites where id = _invite_id for update;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if v_invite.status <> 'pending' then raise exception 'invite_not_pending' using errcode = '22023'; end if;
  if lower(btrim(v_invite.email)) is distinct from v_email then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;

  insert into public.project_members(project_id, user_id, role)
  values (v_invite.project_id, v_actor, v_invite.role)
  on conflict (project_id, user_id) do nothing;
  v_added := found;
  update public.project_invites set status = 'accepted', accepted_at = coalesce(accepted_at, now())
  where id = _invite_id;

  if v_added then
    select owner_id into v_owner from public.projects where id = v_invite.project_id;
    if v_owner is distinct from v_actor and kova_private.can_receive_project_notice(v_owner) then
      insert into public.app_notifications(owner_id, type, title, safe_preview, action_url, source_entity)
      values (
        v_owner, 'project_member_joined', 'A member joined your project',
        'Open the project to review who has access.', '/projects/' || v_invite.project_id::text,
        'project-invite:' || _invite_id::text
      );
    end if;
  end if;
  return v_invite.project_id;
end
$$;

create or replace function public.decline_project_invite(_invite_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_invite public.project_invites;
begin
  if v_actor is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  v_email := public.kova_auth_directory_email(v_actor);
  if v_email is null or exists (
    select 1 from public.account_deletion_fences f where f.user_id = v_actor
  ) then raise exception 'verified_email_required' using errcode = '42501'; end if;

  select * into v_invite from public.project_invites where id = _invite_id for update;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if v_invite.status <> 'pending' then raise exception 'invite_not_pending' using errcode = '22023'; end if;
  if lower(btrim(v_invite.email)) is distinct from v_email then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;
  update public.project_invites set status = 'revoked', accepted_at = null where id = _invite_id;
  return true;
end
$$;

revoke all on function public.accept_project_invite(uuid), public.decline_project_invite(uuid)
  from public, anon, authenticated;
grant execute on function public.accept_project_invite(uuid), public.decline_project_invite(uuid)
  to authenticated, service_role;

commit;
