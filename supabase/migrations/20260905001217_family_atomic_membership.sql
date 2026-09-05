-- Publish a family group and its owner membership in one transaction. Invite
-- redemption uses the same principal/group locks and never consumes a token
-- before membership is durable. No billing, identity or safety policy changes.
create or replace function public.enforce_family_member_cap()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.family_groups where id = new.group_id for update;
  if not found then raise exception 'family_group_unavailable'; end if;
  if (new.role = 'owner') is distinct from (new.user_id = v_owner)
  then raise exception 'invalid_family_member_role'; end if;
  if exists(select 1 from public.family_members where group_id = new.group_id and user_id = new.user_id)
  then return new; end if;
  if (select count(*) from public.family_members where group_id = new.group_id) >= 6
  then raise exception 'family_group_full'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_family_member_cap() from public, anon, authenticated;
grant execute on function public.enforce_family_member_cap() to service_role;

create function public.create_or_repair_family_group(p_owner_id uuid, p_name text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_group uuid; v_membership uuid;
begin
  if p_owner_id is null or p_name is null or length(btrim(p_name)) not between 1 and 60
  then raise exception 'invalid_family_group'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 20260903204500));
  if not kova_private.auth_user_exists(p_owner_id)
    or exists(select 1 from public.account_deletion_fences where user_id = p_owner_id)
  then raise exception 'account_deletion_pending'; end if;
  -- A principal may belong to only one household, including ownership.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 20260905001217));
  select group_id into v_membership from public.family_members where user_id = p_owner_id for update;
  select id into v_group from public.family_groups where owner_id = p_owner_id;
  if v_membership is not null and v_membership is distinct from v_group
  then raise exception 'already_in_family'; end if;
  insert into public.family_groups(owner_id,name) values(p_owner_id,btrim(p_name))
    on conflict(owner_id) do nothing;
  select id into strict v_group from public.family_groups where owner_id = p_owner_id for update;
  insert into public.family_members(group_id,user_id,role) values(v_group,p_owner_id,'owner')
    on conflict(group_id,user_id) do update set role = 'owner';
  return v_group;
end;
$$;

create function public.accept_family_invite_atomic(p_user_id uuid, p_token text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_invite public.family_invites; v_owner uuid; v_user uuid; v_existing uuid; v_recipient uuid;
begin
  if p_user_id is null or p_token is null or p_token !~ '^[0-9a-f]{48}$'
  then raise exception 'invalid_family_invite'; end if;
  select i.* into v_invite from public.family_invites i where token = p_token;
  if not found then raise exception 'invalid_family_invite'; end if;
  select owner_id into v_owner from public.family_groups where id = v_invite.group_id;
  if v_owner is null then raise exception 'invalid_family_invite'; end if;
  for v_user in select distinct x from unnest(array[p_user_id,v_owner]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 20260903204500));
    if not kova_private.auth_user_exists(v_user)
      or exists(select 1 from public.account_deletion_fences where user_id = v_user)
    then raise exception 'account_deletion_pending'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260905001217));
  -- Group locks serialize membership-cap decisions; invitation state is checked
  -- only after the same lock, including retries and concurrent revocation.
  perform 1 from public.family_groups where id = v_invite.group_id for update;
  if not found then raise exception 'invalid_family_invite'; end if;
  select * into v_invite from public.family_invites where token = p_token for update;
  if not found then raise exception 'invalid_family_invite'; end if;
  select group_id into v_existing from public.family_members where user_id = p_user_id for update;
  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = p_user_id and v_existing = v_invite.group_id
    then return v_invite.group_id; end if;
    raise exception 'family_invite_used';
  end if;
  if v_invite.expires_at <= now() then raise exception 'family_invite_expired'; end if;
  if p_user_id = v_owner or v_existing is not null
    or exists(select 1 from public.family_groups where owner_id = p_user_id)
  then raise exception 'already_in_family'; end if;
  if v_invite.invited_email is not null then
    v_recipient := kova_private.verified_auth_user_for_email(v_invite.invited_email);
    if v_recipient is distinct from p_user_id
    then raise exception 'family_invite_recipient_mismatch'; end if;
  end if;
  insert into public.family_members(group_id,user_id,role) values(v_invite.group_id,p_user_id,'member');
  update public.family_invites set accepted_at = now(), accepted_by = p_user_id where id = v_invite.id;
  return v_invite.group_id;
end;
$$;

revoke insert on public.family_groups from public, anon, authenticated;
revoke insert, update on public.family_members from public, anon, authenticated;
revoke all on function public.create_or_repair_family_group(uuid,text),
  public.accept_family_invite_atomic(uuid,text) from public, anon, authenticated;
grant execute on function public.create_or_repair_family_group(uuid,text),
  public.accept_family_invite_atomic(uuid,text) to service_role;
