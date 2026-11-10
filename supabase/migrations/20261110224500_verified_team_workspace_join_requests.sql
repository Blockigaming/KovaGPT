-- Workspace domains are *verified associations*, not an email suffix guess.
-- A privileged domain-verification process must record external ownership proof
-- before inserting/updating these rows. This migration never auto-verifies domains.
create table if not exists public.team_verified_domains (
  team_id uuid not null references public.team_workspaces(id) on delete cascade,
  domain text not null check(domain = lower(btrim(domain)) and domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'),
  verified_at timestamptz not null,
  verification_method text not null check (verification_method in ('dns_txt','admin_verified')),
  verification_reference text not null,
  primary key (team_id, domain)
);
create index if not exists team_verified_domains_domain_idx on public.team_verified_domains(domain);
alter table public.team_verified_domains enable row level security;
revoke all on public.team_verified_domains from public, anon, authenticated;
grant all on public.team_verified_domains to service_role;

-- No request produces team membership automatically. The owner must review,
-- and the existing paid-seat invitation path remains authoritative.
create table if not exists public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.team_workspaces(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_email text not null check (requester_email = lower(btrim(requester_email))),
  status text not null default 'pending' check(status in ('pending','approved','denied','withdrawn')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  notification_sent_at timestamptz,
  notification_provider_id text,
  notification_started_at timestamptz,
  notification_lease_until timestamptz,
  notification_attempts integer not null default 0 check(notification_attempts between 0 and 6),
  unique (team_id, requester_id)
);
create index if not exists team_join_requests_owner_queue on public.team_join_requests(team_id, status, requested_at);
alter table public.team_join_requests enable row level security;
revoke all on public.team_join_requests from public, anon, authenticated;
grant all on public.team_join_requests to service_role;

-- Operations are service-role only, user verification comes from the trusted
-- Kova account directory (not client-supplied email or team ownership).
create or replace function public.discover_verified_team_workspaces(p_actor uuid)
returns table(team_id uuid, team_name text, request_status text)
language sql stable security invoker set search_path='' as $$
  select t.id, t.name, coalesce(r.status,'none')
  from public.team_workspaces t
  join public.team_verified_domains d on d.team_id=t.id
  left join public.team_join_requests r on r.team_id=t.id and r.requester_id=p_actor
  where kova_private.team_verified_email(p_actor) is not null
    and split_part(lower(kova_private.team_verified_email(p_actor)),'@',2)=d.domain
    and d.domain not in ('gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com','outlook.com','hotmail.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com','proton.me','protonmail.com','pm.me','mail.com','gmx.com','gmx.net','zoho.com')
    and t.status in ('active','trialing')
    and not t.billing_hold
    and t.owner_id<>p_actor
    and not exists(select 1 from public.team_members m
      where m.team_id=t.id and m.user_id=p_actor and m.state in ('active','invited'))
    and not exists(select 1 from public.account_deletion_fences f where f.user_id=p_actor)
  order by t.name limit 20
$$;
revoke all on function public.discover_verified_team_workspaces(uuid) from public,anon,authenticated;
grant execute on function public.discover_verified_team_workspaces(uuid) to service_role;

create or replace function public.request_verified_team_join(p_actor uuid,p_team uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_email text; v_id uuid;
begin
 v_email:=lower(kova_private.team_verified_email(p_actor));
 if v_email is null then raise exception 'Verify your email before requesting to join'; end if;
 if not exists(select 1 from public.discover_verified_team_workspaces(p_actor) d where d.team_id=p_team)
 then raise exception 'No verified workspace is available'; end if;
 if exists(select 1 from public.team_join_requests where team_id=p_team and requester_id=p_actor
   and status='denied' and reviewed_at > now()-interval '7 days')
 then raise exception 'Try again after the review period'; end if;
 insert into public.team_join_requests(team_id, requester_id, requester_email)
 values (p_team,p_actor,v_email)
 on conflict(team_id,requester_id) do update set status='pending',
   requester_email=excluded.requester_email,requested_at=now(),reviewed_at=null,reviewed_by=null,
   notification_sent_at=null,notification_provider_id=null,
   notification_started_at=null,notification_lease_until=null,notification_attempts=0
   where public.team_join_requests.status not in ('pending','approved')
 returning id into v_id;
 if v_id is null then select id into v_id from public.team_join_requests where team_id=p_team and requester_id=p_actor; end if;
 return v_id;
end $$;
revoke all on function public.request_verified_team_join(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_verified_team_join(uuid,uuid) to service_role;

create or replace function public.review_verified_team_join(p_actor uuid,p_id uuid,p_approve boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.team_join_requests; t public.team_workspaces;
begin
 select * into r from public.team_join_requests where id=p_id for update;
 if r.id is null then raise exception 'Request not found'; end if;
 select * into t from public.team_workspaces where id=r.team_id for update;
 if t.owner_id is distinct from p_actor or kova_private.team_verified_email(p_actor) is null
 then raise exception 'Only the verified workspace owner may review this request'; end if;
 if r.status<>'pending' then raise exception 'Request is no longer pending'; end if;
 update public.team_join_requests set status=case when p_approve then 'approved' else 'denied' end,
 reviewed_at=now(),reviewed_by=p_actor where id=p_id;
 -- Approval is permission to invite, not a free seat/membership mutation.
 -- Owner must use existing paid-seat team invitation to grant access.
 return true;
end $$;
revoke all on function public.review_verified_team_join(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.review_verified_team_join(uuid,uuid,boolean) to service_role;


-- Claim the precise notification with a lease. The same immutable provider
-- idempotency key is reused for all retries; stop before the provider's
-- 24-hour deduplication window can expire.
create or replace function public.claim_team_join_notification(p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.team_join_requests;
begin
  update public.team_join_requests
  set notification_started_at=coalesce(notification_started_at,now()),
      notification_lease_until=now()+interval '2 minutes',
      notification_attempts=notification_attempts+1
  where id=p_id and status='pending' and notification_sent_at is null
    and (notification_lease_until is null or notification_lease_until < now())
    and notification_attempts < 6
    and requested_at > now()-interval '20 hours'
    and (notification_started_at is null or notification_started_at > now()-interval '20 hours')
  returning * into r;
  if r.id is null then return null; end if;
  return to_jsonb(r);
end $$;
revoke all on function public.claim_team_join_notification(uuid) from public,anon,authenticated;
grant execute on function public.claim_team_join_notification(uuid) to service_role;
