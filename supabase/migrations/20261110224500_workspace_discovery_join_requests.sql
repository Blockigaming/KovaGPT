-- Verified-domain discovery and explicit owner-reviewed join requests.
-- The migration creates no memberships; only a separate accepted invitation may grant access.
begin;

create table public.organization_join_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (organization_id,requester_user_id)
);
create index organization_join_requests_organization_pending
  on public.organization_join_requests(organization_id,created_at desc)
  where state = 'pending';
alter table public.organization_join_requests enable row level security;
revoke all on public.organization_join_requests from public,anon,authenticated;
grant all on public.organization_join_requests to service_role;

-- This is not proof of organization membership. A currently verified mailbox and
-- a currently DNS-verified organization domain are both required for discovery.
create function kova_private.workspace_discovery_domain(p_user uuid)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare v_email text;v_domain text;
begin
  v_email := kova_private.account_email_recipient(p_user);
  if v_email is null then return null; end if;
  v_domain := lower(split_part(v_email,'@',2));
  if v_domain in (
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com',
    'outlook.com','hotmail.com','hotmail.co.uk','live.com','msn.com',
    'aol.com','icloud.com','me.com','mac.com','protonmail.com','proton.me'
  ) then return null; end if;
  return v_domain;
end$$;
revoke all on function kova_private.workspace_discovery_domain(uuid) from public,anon,authenticated;
grant execute on function kova_private.workspace_discovery_domain(uuid) to service_role;

create function public.kova_discover_organizations(p_actor_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_domain text;v_result jsonb;
begin
  v_domain := kova_private.workspace_discovery_domain(p_actor_user_id);
  if v_domain is null or exists (
    select 1 from public.account_deletion_fences where user_id=p_actor_user_id
  ) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]'::jsonb)
  into v_result from (
    select o.id,o.name,
      case when r.state='pending' then 'pending'
           when r.state='declined' then 'declined'
           else 'joinable' end as status
    from public.organization_domains d
    join public.organizations o on o.id=d.organization_id
    left join public.organization_join_requests r
      on r.organization_id=o.id and r.requester_user_id=p_actor_user_id
    where d.domain=v_domain and d.state='verified'
      and d.verification_expires_at>statement_timestamp()
      and o.state='active'
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id=o.id and m.user_id=p_actor_user_id
          and m.revoked_at is null
      )
      and not exists (
        select 1 from public.organization_invitations i
        where i.organization_id=o.id and i.recipient_user_id=p_actor_user_id
          and i.state='pending' and i.expires_at>statement_timestamp()
      )
    order by o.name,o.id limit 10
  ) x;
  return v_result;
end$$;
revoke all on function public.kova_discover_organizations(uuid) from public,anon,authenticated;
grant execute on function public.kova_discover_organizations(uuid) to service_role;

-- Idempotent: a refresh or duplicate click cannot send repeated owner alerts.
create function public.kova_request_organization_join(p_actor_user_id uuid,p_organization_id uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare v_domain text;v_request uuid;v_existing text;v_name text;
begin
  if p_actor_user_id is null or p_organization_id is null then
    raise exception 'workspace_join_invalid' using errcode='22023';
  end if;
  v_domain := kova_private.workspace_discovery_domain(p_actor_user_id);
  if v_domain is null or exists (
    select 1 from public.account_deletion_fences where user_id=p_actor_user_id
  ) then raise exception 'workspace_join_forbidden' using errcode='42501'; end if;
  perform kova_private.lock_organization_accounts(array[p_actor_user_id]);
  select o.name into v_name from public.organizations o
    join public.organization_domains d on d.organization_id=o.id
    where o.id=p_organization_id and o.state='active'
      and d.domain=v_domain and d.state='verified'
      and d.verification_expires_at>statement_timestamp()
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id=o.id and m.user_id=p_actor_user_id and m.revoked_at is null
      )
      and not exists (
        select 1 from public.organization_invitations i
        where i.organization_id=o.id and i.recipient_user_id=p_actor_user_id
          and i.state='pending' and i.expires_at>statement_timestamp()
      )
    for share of o,d;
  if v_name is null then raise exception 'workspace_join_unavailable' using errcode='P0002'; end if;
  insert into public.organization_join_requests(organization_id,requester_user_id)
    values(p_organization_id,p_actor_user_id)
    on conflict (organization_id,requester_user_id) do nothing
    returning id into v_request;
  if v_request is null then
    select state into v_existing from public.organization_join_requests
    where organization_id=p_organization_id and requester_user_id=p_actor_user_id;
    return coalesce(v_existing,'pending');
  end if;
  insert into public.app_notifications(owner_id,type,title,safe_preview,action_url,source_entity)
  select m.user_id,'project_invitation','Workspace join request',
    'A verified account requested to join '||v_name||'.',
    '/organization','organization_join:'||v_request::text
  from public.organization_members m
  where m.organization_id=p_organization_id and m.role='owner' and m.revoked_at is null;
  insert into public.organization_audit_events
    (organization_id,actor_user_id,action,details)
    values(p_organization_id,p_actor_user_id,'joinRequested',
       jsonb_build_object('requestId',v_request));
  return 'pending';
end$$;
revoke all on function public.kova_request_organization_join(uuid,uuid) from public,anon,authenticated;
grant execute on function public.kova_request_organization_join(uuid,uuid) to service_role;

-- Only current owners/admins may see addresses and pending requests.
create function public.kova_workspace_join_inbox(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_organization_id is null or not exists (
    select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
      and m.role in ('owner','admin') and m.revoked_at is null and o.state='active'
  ) then raise exception 'workspace_join_forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]'::jsonb)
  into v_result from (
    select r.id,r.organization_id as "organizationId",o.name as "organizationName",
      kova_private.account_email_recipient(r.requester_user_id) as "requesterEmail",
      r.created_at as "createdAt"
    from public.organization_join_requests r join public.organizations o on o.id=r.organization_id
    where r.organization_id=p_organization_id and r.state='pending'
    order by r.created_at desc,r.id limit 50
  ) x where x."requesterEmail" is not null;
  return v_result;
end$$;
revoke all on function public.kova_workspace_join_inbox(uuid,uuid) from public,anon,authenticated;
grant execute on function public.kova_workspace_join_inbox(uuid,uuid) to service_role;

create function public.kova_decline_organization_join(p_actor_user_id uuid,p_request_id uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare v_organization_id uuid;
begin
  select r.organization_id into v_organization_id
    from public.organization_join_requests r where r.id=p_request_id;
  if v_organization_id is null or not exists(
    select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=v_organization_id and m.user_id=p_actor_user_id
      and m.role in ('owner','admin') and m.revoked_at is null and o.state='active'
  ) then raise exception 'workspace_join_forbidden' using errcode='42501'; end if;
  update public.organization_join_requests set state='declined',reviewed_at=now(),reviewed_by=p_actor_user_id
    where id=p_request_id and state='pending';
  return 'declined';
end$$;
revoke all on function public.kova_decline_organization_join(uuid,uuid) from public,anon,authenticated;
grant execute on function public.kova_decline_organization_join(uuid,uuid) to service_role;

commit;
