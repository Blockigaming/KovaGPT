-- Make project invitation acceptance explicit, transactional, and recipient-bound.
-- Owners may create/revoke invites, but only a verified recipient can accept or decline.

create or replace function public.accept_project_invite(_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  invite_project_id uuid;
  invite_email text;
  invite_role public.project_role;
  invite_status text;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(u.email)
    into caller_email
  from auth.users u
  where u.id = caller_id
    and u.email_confirmed_at is not null;

  if caller_email is null or caller_email = '' then
    raise exception 'verified_email_required' using errcode = '42501';
  end if;

  select i.project_id, lower(i.email), i.role, i.status
    into invite_project_id, invite_email, invite_role, invite_status
  from public.project_invites i
  where i.id = _invite_id
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if invite_status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;
  if invite_email <> caller_email then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;

  insert into public.project_members(project_id, user_id, role)
  values (invite_project_id, caller_id, invite_role)
  on conflict (project_id, user_id) do nothing;

  update public.project_invites
  set status = 'accepted',
      accepted_at = coalesce(accepted_at, now())
  where id = _invite_id;

  return invite_project_id;
end;
$$;

create or replace function public.decline_project_invite(_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  invite_email text;
  invite_status text;
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(u.email)
    into caller_email
  from auth.users u
  where u.id = caller_id
    and u.email_confirmed_at is not null;

  if caller_email is null or caller_email = '' then
    raise exception 'verified_email_required' using errcode = '42501';
  end if;

  select lower(i.email), i.status
    into invite_email, invite_status
  from public.project_invites i
  where i.id = _invite_id
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if invite_status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;
  if invite_email <> caller_email then
    raise exception 'invite_recipient_mismatch' using errcode = '42501';
  end if;

  update public.project_invites
  set status = 'revoked',
      accepted_at = null
  where id = _invite_id;

  return true;
end;
$$;

revoke all on function public.accept_project_invite(uuid) from public, anon, authenticated;
revoke all on function public.decline_project_invite(uuid) from public, anon, authenticated;
grant execute on function public.accept_project_invite(uuid) to authenticated, service_role;
grant execute on function public.decline_project_invite(uuid) to authenticated, service_role;
