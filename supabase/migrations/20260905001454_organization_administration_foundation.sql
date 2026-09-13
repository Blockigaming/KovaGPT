-- Disabled-by-default organization administration. Every browser mutation goes
-- through an authenticated, policy-gated server route and service-only RPC.
-- Membership is explicit; email/domain/SSO claims never create authorization.
begin;
create table public.organizations (
  id uuid primary key,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  revision bigint not null default 1 check (revision > 0),
  state text not null default 'active' check (state in ('active','closed')),
  created_by uuid references auth.users(id) on delete set null,
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  retention_days_draft integer check (retention_days_draft between 1 and 3650),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(), revoked_at timestamptz,
  primary key(organization_id,user_id)
);
create index organization_members_user_active on public.organization_members(user_id,organization_id) where revoked_at is null;
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  role text not null check (role in ('owner','admin','member')),
  state text not null default 'pending' check (state in ('pending','accepted','revoked')),
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now()
);
create unique index organization_invitation_pending on public.organization_invitations(organization_id,recipient_user_id) where state='pending';
create index organization_invitation_recipient on public.organization_invitations(recipient_user_id,created_at desc,id);
create table public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null check (domain=lower(domain) and char_length(domain) between 4 and 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  state text not null default 'pending' check (state in ('pending','verified','revoked')),
  challenge_token uuid not null default gen_random_uuid(),
  verified_at timestamptz, verification_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,domain)
);
create unique index organization_domain_verified_unique on public.organization_domains(domain) where state='verified';
create table public.organization_sso_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  domain_id uuid not null references public.organization_domains(id),
  provider_id uuid not null,
  state text not null check (state in ('configured','disabled')),
  configured_at timestamptz not null default now()
);
create table public.organization_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  action text not null check (char_length(action) between 1 and 60),
  subject_user_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and pg_column_size(details)<=2048),
  created_at timestamptz not null default now()
);
create index organization_audit_page on public.organization_audit_events(organization_id,id);
create table public.organization_mutation_receipts (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request_hash text not null,
  result jsonb not null check (pg_column_size(result)<=4096),
  created_at timestamptz not null default now(),
  primary key(actor_user_id,mutation_id)
);

do $$declare t text;begin
  foreach t in array array['organizations','organization_members','organization_invitations','organization_domains',
    'organization_sso_connections','organization_audit_events','organization_mutation_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end$$;
grant usage,select on sequence public.organization_audit_events_id_seq to service_role;

-- RLS recursion helper: only the current JWT principal's membership is read.
-- Auth deletion removes membership; an account-deletion fence denies it early.
create function kova_private.current_organization_role(p_organization_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select m.role from public.organization_members m join public.organizations o on o.id=m.organization_id
  where m.organization_id=p_organization_id and m.user_id=(select auth.uid())
    and m.revoked_at is null and o.state='active'
    and not exists(select 1 from public.account_deletion_fences f where f.user_id=m.user_id)
$$;
revoke all on function kova_private.current_organization_role(uuid) from public,anon;
grant execute on function kova_private.current_organization_role(uuid) to authenticated,service_role;
grant select on public.organizations,public.organization_members,public.organization_invitations,
  public.organization_domains,public.organization_sso_connections,public.organization_audit_events to authenticated;
create policy organizations_current_member on public.organizations for select to authenticated
  using(kova_private.current_organization_role(id) is not null);
create policy organization_members_current_member on public.organization_members for select to authenticated
  using(kova_private.current_organization_role(organization_id) is not null
    and (revoked_at is null or kova_private.current_organization_role(organization_id) in ('owner','admin')));
create policy organization_invitations_target on public.organization_invitations for select to authenticated
  using(recipient_user_id=(select auth.uid()) or kova_private.current_organization_role(organization_id) in ('owner','admin'));
create policy organization_domains_owner on public.organization_domains for select to authenticated
  using(kova_private.current_organization_role(organization_id)='owner');
create policy organization_sso_owner on public.organization_sso_connections for select to authenticated
  using(kova_private.current_organization_role(organization_id)='owner');
create policy organization_audit_admin on public.organization_audit_events for select to authenticated
  using(kova_private.current_organization_role(organization_id) in ('owner','admin'));

-- Lock accounts before tenants, always in stable order. All organization writes
-- use this shared lock so deletion cannot race a newly granted ownership role.
create function kova_private.lock_organization_accounts(p_users uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare v_user uuid;begin
  for v_user in select distinct u from unnest(p_users) u where u is not null order by u loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,20260903204500));
    if not kova_private.auth_user_exists(v_user) or exists(select 1 from public.account_deletion_fences where user_id=v_user) then
      raise exception 'organization_account_unavailable' using errcode='42501';
    end if;
  end loop;
end$$;
revoke all on function kova_private.lock_organization_accounts(uuid[]) from public,anon,authenticated;
grant execute on function kova_private.lock_organization_accounts(uuid[]) to service_role;

create function public.mutate_organization(
  p_actor_user_id uuid,p_mutation_id uuid,p_organization_id uuid,p_expected_revision bigint,
  p_action text,p_payload jsonb,p_policy_version text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_org public.organizations%rowtype; v_role text; v_target uuid; v_target_role text;
  v_invite public.organization_invitations%rowtype; v_domain public.organization_domains%rowtype;
  v_hash text; v_receipt public.organization_mutation_receipts%rowtype;
  v_result jsonb; v_details jsonb:='{}'; v_id uuid; v_count integer;
  v_domain_key text; v_locked_org uuid; v_expired public.organization_domains%rowtype;
begin
  if p_actor_user_id is null or p_mutation_id is null or p_organization_id is null
    or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object'
    or pg_column_size(p_payload)>16384 or p_policy_version is null or char_length(p_policy_version) not between 1 and 80 then
    raise exception 'organization_request_invalid' using errcode='22023';
  end if;
  if p_action='invite' then
    -- Cap before the private Auth lookup. Only a current owner/admin may resolve
    -- an invitation target; no public account-enumeration RPC is exposed.
    select role into v_role from public.organization_members where organization_id=p_organization_id
      and user_id=p_actor_user_id and revoked_at is null;
    if v_role not in ('owner','admin') or v_role is null then raise exception 'organization_forbidden' using errcode='42501'; end if;
    if (select count(*) from public.organization_invitations where organization_id=p_organization_id and state='pending' and expires_at>now())>=50 then
      raise exception 'organization_invitation_capacity' using errcode='54000';
    end if;
    v_target:=kova_private.verified_auth_user_for_email(p_payload->>'email');
    if v_target is null then raise exception 'organization_recipient_unavailable' using errcode='22023'; end if;
  elsif p_action in ('setRole','removeMember') then
    v_target:=(p_payload->>'userId')::uuid;
  end if;
  perform kova_private.lock_organization_accounts(array[p_actor_user_id,v_target]);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_mutation_id::text,20260905001454));
  v_hash:=md5(jsonb_build_object('organizationId',p_organization_id,'revision',p_expected_revision,'action',p_action,'payload',p_payload,'policy',p_policy_version)::text);
  select * into v_receipt from public.organization_mutation_receipts where actor_user_id=p_actor_user_id and mutation_id=p_mutation_id;
  if found then
    if v_receipt.request_hash<>v_hash then raise exception 'organization_idempotency_conflict' using errcode='40001'; end if;
    return v_receipt.result;
  end if;
  if (select count(*) from public.organization_mutation_receipts where actor_user_id=p_actor_user_id)>=10000 then
    raise exception 'organization_receipt_capacity' using errcode='54000';
  end if;
  if p_action='verifyDomain' then
    -- Cross-tenant expiry changes take one domain lock before any tenant lock.
    -- All affected tenants then lock in UUID order, including the requesting one.
    select d.domain into v_domain_key from public.organization_domains d
      join public.organization_members m on m.organization_id=d.organization_id
      join public.organizations o on o.id=d.organization_id
      where d.id=(p_payload->>'domainId')::uuid and d.organization_id=p_organization_id
        and d.state<>'revoked' and o.state='active' and m.user_id=p_actor_user_id and m.role='owner' and m.revoked_at is null;
    if not found then raise exception 'organization_forbidden' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_domain_key,20260905001455));
    for v_locked_org in select o.id from public.organizations o where o.id=p_organization_id
      or exists(select 1 from public.organization_domains d where d.organization_id=o.id and d.domain=v_domain_key)
      order by o.id for update loop null; end loop;
  end if;
  if p_action='create' then
    if p_expected_revision<>0 or char_length(btrim(coalesce(p_payload->>'name',''))) not between 1 and 100 then
      raise exception 'organization_request_invalid' using errcode='22023';
    end if;
    if (select count(*) from public.organizations where created_by=p_actor_user_id and state='active')>=5 then
      raise exception 'organization_capacity' using errcode='54000';
    end if;
    if (select count(*) from public.organization_members m join public.organizations o on o.id=m.organization_id where m.user_id=p_actor_user_id and m.revoked_at is null and o.state='active')>=100 then raise exception 'organization_membership_capacity' using errcode='54000'; end if;
    insert into public.organizations(id,name,created_by,policy_version)
      values(p_organization_id,btrim(p_payload->>'name'),p_actor_user_id,p_policy_version) returning * into v_org;
    insert into public.organization_members(organization_id,user_id,role) values(p_organization_id,p_actor_user_id,'owner');
  else
    select * into v_org from public.organizations where id=p_organization_id for update;
    if not found or v_org.state<>'active' then raise exception 'organization_not_found' using errcode='P0002'; end if;
    if v_org.revision<>p_expected_revision then raise exception 'organization_revision_conflict' using errcode='40001'; end if;
    select role into v_role from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and revoked_at is null;
    if p_action in ('acceptInvite','declineInvite') then
      select * into v_invite from public.organization_invitations where id=(p_payload->>'invitationId')::uuid
        and organization_id=p_organization_id and recipient_user_id=p_actor_user_id and state='pending' and expires_at>now() for update;
      if not found then raise exception 'organization_invitation_unavailable' using errcode='42501'; end if;
      if p_action='declineInvite' then
        update public.organization_invitations set state='revoked' where id=v_invite.id;
      else
      if (select count(*) from public.organization_members m join public.organizations o on o.id=m.organization_id where m.user_id=p_actor_user_id and m.revoked_at is null and o.state='active')>=100 then raise exception 'organization_membership_capacity' using errcode='54000'; end if;
      if v_role is not null then raise exception 'organization_already_member' using errcode='40001'; end if;
      if (select count(*) from public.organization_members where organization_id=p_organization_id and revoked_at is null)>=100 then
        raise exception 'organization_member_capacity' using errcode='54000'; end if;
      insert into public.organization_members(organization_id,user_id,role) values(p_organization_id,p_actor_user_id,v_invite.role)
        on conflict(organization_id,user_id) do update set role=excluded.role,revoked_at=null,joined_at=now();
      update public.organization_invitations set state='accepted' where id=v_invite.id;
      end if;
      v_target:=p_actor_user_id; v_details:=jsonb_build_object('role',v_invite.role);
    else
      if v_role is null then raise exception 'organization_forbidden' using errcode='42501'; end if;
      if p_action='rename' then
        if v_role<>'owner' then raise exception 'organization_forbidden' using errcode='42501'; end if;
        if char_length(btrim(coalesce(p_payload->>'name',''))) not between 1 and 100 then raise exception 'organization_request_invalid' using errcode='22023'; end if;
        update public.organizations set name=btrim(p_payload->>'name') where id=p_organization_id;
      elsif p_action='invite' then
        if (select count(*) from public.organization_invitations where organization_id=p_organization_id and state='pending' and expires_at>now())>=50 then raise exception 'organization_invitation_capacity' using errcode='54000'; end if;
        if v_role not in ('owner','admin') or (v_role='admin' and p_payload->>'role'<>'member')
          or p_payload->>'role' not in ('owner','admin','member') then raise exception 'organization_forbidden' using errcode='42501'; end if;
        if exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=v_target and revoked_at is null) then
          raise exception 'organization_already_member' using errcode='40001'; end if;
        if (select count(*) from public.organization_invitations where recipient_user_id=v_target and state='pending' and expires_at>now())>=100 then raise exception 'organization_recipient_invitation_capacity' using errcode='54000'; end if;
        update public.organization_invitations set state='revoked' where organization_id=p_organization_id and recipient_user_id=v_target and state='pending';
        insert into public.organization_invitations(organization_id,recipient_user_id,invited_by,role)
          values(p_organization_id,v_target,p_actor_user_id,p_payload->>'role') returning id into v_id;
        v_details:=jsonb_build_object('role',p_payload->>'role');
      elsif p_action='revokeInvite' then
        select * into v_invite from public.organization_invitations where id=(p_payload->>'invitationId')::uuid and organization_id=p_organization_id and state='pending' for update;
        if not found or v_role not in ('owner','admin') or (v_role='admin' and v_invite.role<>'member') then raise exception 'organization_forbidden' using errcode='42501'; end if;
        update public.organization_invitations set state='revoked' where id=v_invite.id;
        v_target:=v_invite.recipient_user_id;
      elsif p_action in ('setRole','removeMember','leave') then
        if p_action='leave' then v_target:=p_actor_user_id; end if;
        select role into v_target_role from public.organization_members where organization_id=p_organization_id and user_id=v_target and revoked_at is null for update;
        if v_target_role is null then raise exception 'organization_member_not_found' using errcode='P0002'; end if;
        if p_action='setRole' and (v_role<>'owner' or p_payload->>'role' not in ('owner','admin','member')) then raise exception 'organization_forbidden' using errcode='42501'; end if;
        if p_action='removeMember' and (v_role not in ('owner','admin') or (v_role='admin' and v_target_role<>'member')) then raise exception 'organization_forbidden' using errcode='42501'; end if;
        if v_target_role='owner' and (p_action<>'setRole' or p_payload->>'role'<>'owner') and not exists(
          select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id<>v_target and m.role='owner' and m.revoked_at is null
            and not exists(select 1 from public.account_deletion_fences f where f.user_id=m.user_id)
        ) then raise exception 'organization_last_owner' using errcode='40001'; end if;
        if p_action='setRole' then update public.organization_members set role=p_payload->>'role' where organization_id=p_organization_id and user_id=v_target;
        else update public.organization_members set revoked_at=now() where organization_id=p_organization_id and user_id=v_target; end if;
        v_details:=jsonb_build_object('previousRole',v_target_role,'role',case when p_action='setRole' then p_payload->>'role' else null end);
      elsif p_action='claimDomain' then
        if v_role<>'owner' then raise exception 'organization_forbidden' using errcode='42501'; end if;
        if (select count(*) from public.organization_domains where organization_id=p_organization_id and state<>'revoked')>=5 then raise exception 'organization_domain_capacity' using errcode='54000'; end if;
        insert into public.organization_domains(organization_id,domain) values(p_organization_id,p_payload->>'domain')
          on conflict(organization_id,domain) do update set state='pending',challenge_token=gen_random_uuid(),verified_at=null,verification_expires_at=null returning id into v_id;
        update public.organization_sso_connections set state='disabled' where organization_id=p_organization_id;
        v_details:=jsonb_build_object('domain',p_payload->>'domain');
      elsif p_action in ('verifyDomain','revokeDomain','configureSso') then
        if v_role<>'owner' then raise exception 'organization_forbidden' using errcode='42501'; end if;
        select * into v_domain from public.organization_domains where id=(p_payload->>'domainId')::uuid and organization_id=p_organization_id and state<>'revoked' for update;
        if not found then raise exception 'organization_domain_unavailable' using errcode='P0002'; end if;
        if p_action='verifyDomain' then
          if p_payload->>'verifiedChallenge' is distinct from v_domain.challenge_token::text then raise exception 'organization_domain_proof_required' using errcode='42501'; end if;
          for v_expired in select * from public.organization_domains where domain=v_domain.domain and id<>v_domain.id
            and state='verified' and (verification_expires_at is null or verification_expires_at<=now()) order by organization_id for update loop
            update public.organization_domains set state='pending',challenge_token=gen_random_uuid(),verified_at=null,verification_expires_at=null where id=v_expired.id;
            update public.organization_sso_connections set state='disabled' where domain_id=v_expired.id;
            update public.organizations set revision=revision+1,updated_at=now() where id=v_expired.organization_id;
            insert into public.organization_audit_events(organization_id,action,details)
              values(v_expired.organization_id,'domainVerificationExpired',jsonb_build_object('domain',v_expired.domain));
          end loop;
          update public.organization_domains set state='verified',verified_at=now(),verification_expires_at=now()+interval '24 hours' where id=v_domain.id;
        elsif p_action='revokeDomain' then
          update public.organization_domains set state='revoked',challenge_token=gen_random_uuid(),verified_at=null,verification_expires_at=null where id=v_domain.id;
          update public.organization_sso_connections set state='disabled' where domain_id=v_domain.id;
        else
          if v_domain.state<>'verified' or v_domain.verification_expires_at<=now() or p_payload->>'providerId' is null then raise exception 'organization_sso_not_ready' using errcode='42501'; end if;
          insert into public.organization_sso_connections(organization_id,domain_id,provider_id,state)
            values(p_organization_id,v_domain.id,(p_payload->>'providerId')::uuid,'configured')
            on conflict(organization_id) do update set domain_id=excluded.domain_id,provider_id=excluded.provider_id,state='configured',configured_at=now();
        end if;
        v_details:=jsonb_build_object('domain',v_domain.domain);
      elsif p_action='disableSso' then
        if v_role<>'owner' then raise exception 'organization_forbidden' using errcode='42501'; end if;
        update public.organization_sso_connections set state='disabled' where organization_id=p_organization_id;
      elsif p_action='saveRetentionDraft' then
        if v_role<>'owner' or (p_payload->>'days')::integer not between 1 and 3650 then raise exception 'organization_forbidden' using errcode='42501'; end if;
        update public.organizations set retention_days_draft=(p_payload->>'days')::integer where id=p_organization_id;
        v_details:=jsonb_build_object('draftDays',(p_payload->>'days')::integer,'enforced',false);
      elsif p_action='close' then
        if v_role<>'owner' or p_payload->>'confirmation' is distinct from v_org.name or exists(
          select 1 from public.organization_members where organization_id=p_organization_id and user_id<>p_actor_user_id and revoked_at is null
        ) then raise exception 'organization_close_requires_sole_owner' using errcode='40001'; end if;
        update public.organizations set state='closed' where id=p_organization_id;
        update public.organization_members set revoked_at=now() where organization_id=p_organization_id and revoked_at is null;
        update public.organization_invitations set state='revoked' where organization_id=p_organization_id and state='pending';
        update public.organization_domains set state='revoked',challenge_token=gen_random_uuid() where organization_id=p_organization_id;
        update public.organization_sso_connections set state='disabled' where organization_id=p_organization_id;
      else raise exception 'organization_action_invalid' using errcode='22023';
      end if;
    end if;
    update public.organizations set revision=revision+1,updated_at=now() where id=p_organization_id returning * into v_org;
  end if;
  insert into public.organization_audit_events(organization_id,actor_user_id,action,subject_user_id,details)
    values(p_organization_id,p_actor_user_id,p_action,v_target,v_details);
  v_result:=jsonb_build_object('organizationId',p_organization_id,'revision',v_org.revision,'id',v_id,'action',p_action);
  insert into public.organization_mutation_receipts(actor_user_id,mutation_id,request_hash,result) values(p_actor_user_id,p_mutation_id,v_hash,v_result);
  return v_result;
end$$;
revoke all on function public.mutate_organization(uuid,uuid,uuid,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.mutate_organization(uuid,uuid,uuid,bigint,text,jsonb,text) to service_role;

-- Must run before export/Storage cleanup or Stripe retirement. It establishes
-- the shared fence only after every tenant has another non-deleting owner.
create function public.prepare_org_account_deletion(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_org uuid;begin
  if p_user_id is null or not kova_private.auth_user_exists(p_user_id) then raise exception 'organization_account_unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
  for v_org in select o.id from public.organizations o join public.organization_members m on m.organization_id=o.id
    where m.user_id=p_user_id and m.role='owner' and m.revoked_at is null and o.state='active' order by o.id loop
    perform 1 from public.organizations where id=v_org for update;
    if not exists(select 1 from public.organization_members m where m.organization_id=v_org and m.user_id<>p_user_id and m.role='owner' and m.revoked_at is null
      and not exists(select 1 from public.account_deletion_fences f where f.user_id=m.user_id)) then
      raise exception 'organization_ownership_transfer_required' using errcode='40001'; end if;
  end loop;
  insert into public.account_deletion_fences(user_id) values(p_user_id) on conflict(user_id) do update set updated_at=now();
  return true;
end$$;
revoke all on function public.prepare_org_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_org_account_deletion(uuid) to service_role;

-- Final Auth deletion safety backstop; the API preflight above prevents this
-- from being the first time an owner learns that ownership transfer is required.
create function kova_private.guard_organization_owner_auth_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid;begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text,20260903204500));
  for v_org in select o.id from public.organizations o join public.organization_members m on m.organization_id=o.id
    where m.user_id=old.id and m.role='owner' and m.revoked_at is null and o.state='active' order by o.id loop
    perform 1 from public.organizations where id=v_org for update;
    if not exists(select 1 from public.organization_members m where m.organization_id=v_org and m.user_id<>old.id and m.role='owner' and m.revoked_at is null
      and not exists(select 1 from public.account_deletion_fences f where f.user_id=m.user_id)) then
      raise exception 'organization_ownership_transfer_required' using errcode='40001'; end if;
  end loop;
  return old;
end$$;
revoke all on function kova_private.guard_organization_owner_auth_deletion() from public,anon,authenticated;
create trigger guard_organization_owner_auth_deletion before delete on auth.users
  for each row execute function kova_private.guard_organization_owner_auth_deletion();
create function public.read_organization_workspace(
  p_actor_user_id uuid,p_organization_id uuid default null,p_view text default 'workspace',
  p_cursor bigint default 0,p_through bigint default null,p_limit integer default 100
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org public.organizations%rowtype;v_role text;v_data jsonb;v_items jsonb;v_through bigint;v_next bigint;v_more boolean;
begin
  if p_actor_user_id is null or not kova_private.auth_user_exists(p_actor_user_id)
    or exists(select 1 from public.account_deletion_fences where user_id=p_actor_user_id) then raise exception 'organization_forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 200 or p_cursor is null or p_cursor<0
    or (p_cursor>0 and p_through is null) or (p_through is not null and p_through<p_cursor)
    or p_view not in ('workspace','audit') then raise exception 'organization_request_invalid' using errcode='22023'; end if;
  if p_organization_id is null then
    if p_view<>'workspace' then raise exception 'organization_request_invalid' using errcode='22023'; end if;
    select coalesce(jsonb_agg(x order by x.name,x.id),'[]') into v_data from (
      select o.id,o.name,o.revision,m.role from public.organizations o join public.organization_members m on m.organization_id=o.id
      where m.user_id=p_actor_user_id and m.revoked_at is null and o.state='active' order by o.name,o.id limit 100
    ) x;
    select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') into v_items from (
      select i.id,i.organization_id,o.name,i.role,i.expires_at,i.created_at,o.revision from public.organization_invitations i
      join public.organizations o on o.id=i.organization_id where i.recipient_user_id=p_actor_user_id
        and i.state='pending' and i.expires_at>now() and o.state='active' order by i.created_at desc,i.id limit 100
    ) x;
    return jsonb_build_object('organizations',v_data,'invitations',v_items);
  end if;
  -- Share tenant lock with revocation, so no read can authorize against a member
  -- removed earlier in the same transaction sequence.
  select * into v_org from public.organizations where id=p_organization_id and state='active' for share;
  if not found then raise exception 'organization_not_found' using errcode='P0002'; end if;
  select role into v_role from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and revoked_at is null;
  if v_role is null then raise exception 'organization_forbidden' using errcode='42501'; end if;
  if p_view='audit' then
    if v_role not in ('owner','admin') then raise exception 'organization_forbidden' using errcode='42501'; end if;
    select coalesce(max(id),0) into v_through from public.organization_audit_events where organization_id=p_organization_id;
    v_through:=least(coalesce(p_through,v_through),v_through);
    select coalesce(jsonb_agg(x order by x.id),'[]'),coalesce(max(x.id),p_cursor) into v_items,v_next from (
      select id,created_at,action,actor_user_id,subject_user_id,details from public.organization_audit_events
      where organization_id=p_organization_id and id>p_cursor and id<=v_through order by id limit p_limit
    ) x;
    select exists(select 1 from public.organization_audit_events where organization_id=p_organization_id and id>v_next and id<=v_through) into v_more;
    if p_cursor=0 then insert into public.organization_audit_events(organization_id,actor_user_id,action,details)
      values(p_organization_id,p_actor_user_id,'auditExport',jsonb_build_object('through',v_through)); end if;
    return jsonb_build_object('events',v_items,'nextCursor',v_next,'through',v_through,'hasMore',v_more);
  end if;
  select coalesce(jsonb_agg(x order by x.joined_at,x.user_id),'[]') into v_items from (
    select user_id,role,joined_at from public.organization_members where organization_id=p_organization_id and revoked_at is null order by joined_at,user_id limit 100
  ) x;
  v_data:=jsonb_build_object('organization',jsonb_build_object('id',v_org.id,'name',v_org.name,'revision',v_org.revision,'role',v_role,
    'retentionDaysDraft',v_org.retention_days_draft,'retentionEnforced',false,'policyVersion',v_org.policy_version),'members',v_items);
  if v_role in ('owner','admin') then
    select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') into v_items from (
      select id,recipient_user_id,role,state,expires_at,created_at from public.organization_invitations
      where organization_id=p_organization_id and state='pending' and expires_at>now() order by created_at desc,id limit 50
    ) x;
    v_data:=v_data||jsonb_build_object('pendingInvitations',v_items);
  end if;
  if v_role='owner' then
    select coalesce(jsonb_agg(x order by x.domain,x.id),'[]') into v_items from (
      select id,domain,state,challenge_token,verified_at,verification_expires_at from public.organization_domains
      where organization_id=p_organization_id and state<>'revoked' order by domain,id limit 5
    ) x;
    v_data:=v_data||jsonb_build_object('domains',v_items);
    select jsonb_build_object('state',c.state,'domainId',c.domain_id,'verified',d.state='verified' and d.verification_expires_at>now()) into v_items
      from public.organization_sso_connections c join public.organization_domains d on d.id=c.domain_id where c.organization_id=p_organization_id;
    v_data:=v_data||jsonb_build_object('sso',v_items);
  end if;
  return v_data;
end$$;
revoke all on function public.read_organization_workspace(uuid,uuid,text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.read_organization_workspace(uuid,uuid,text,bigint,bigint,integer) to service_role;
create function public.purge_organization_mutation_receipts(p_before timestamptz,p_limit integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;begin
  if p_before is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'organization_receipt_cleanup_invalid' using errcode='22023'; end if;
  with expired as (select actor_user_id,mutation_id from public.organization_mutation_receipts
    where created_at<least(p_before,now()-interval '8 days') order by created_at,actor_user_id,mutation_id limit p_limit for update skip locked)
  delete from public.organization_mutation_receipts r using expired e where r.actor_user_id=e.actor_user_id and r.mutation_id=e.mutation_id;
  get diagnostics v_count=row_count;return v_count;
end$$;
revoke all on function public.purge_organization_mutation_receipts(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.purge_organization_mutation_receipts(timestamptz,integer) to service_role;
create function kova_private.guard_organization_last_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.role<>'owner' or old.revoked_at is not null then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='UPDATE' and new.role='owner' and new.revoked_at is null then return new; end if;
  perform 1 from public.organizations where id=old.organization_id and state='active' for update;
  if found and not exists(select 1 from public.organization_members m where m.organization_id=old.organization_id and m.user_id<>old.user_id
    and m.role='owner' and m.revoked_at is null and not exists(select 1 from public.account_deletion_fences f where f.user_id=m.user_id)) then
    raise exception 'organization_last_owner' using errcode='40001'; end if;
  return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function kova_private.guard_organization_last_owner() from public,anon,authenticated;
create trigger guard_organization_last_owner before delete or update of role,revoked_at on public.organization_members
for each row execute function kova_private.guard_organization_last_owner();
commit;
