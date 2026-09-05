-- Voluntary in-app contacts only. No chat access, surveillance, or alerts.
-- Production activation requires the separately approved consent/policy gate.
create table public.trusted_contacts (
  id uuid primary key,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  inviter_email text not null,
  recipient_email text not null,
  purpose text not null default 'manual_check_in' check(purpose='manual_check_in'),
  policy_version text not null check(policy_version='trusted-contact-consent-v1'),
  inviter_consented_at timestamptz not null default now(),
  recipient_consented_at timestamptz,
  state text not null default 'pending' check(state in ('pending','accepted','declined','revoked')),
  revision bigint not null default 1,
  expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  token_digest text check(token_digest is null or token_digest ~ '^[a-f0-9]{64}$'),
  token_expires_at timestamptz,
  last_command_id uuid,
  last_actor_id uuid,
  last_action text,
  last_fingerprint text,
  check(inviter_id<>recipient_id)
);
create index trusted_contacts_inviter_idx on public.trusted_contacts(inviter_id,created_at desc);
create index trusted_contacts_recipient_idx on public.trusted_contacts(recipient_id,created_at desc);
alter table public.trusted_contacts enable row level security;
revoke all on public.trusted_contacts from public,anon,authenticated;
grant all on public.trusted_contacts to service_role;
grant select(id,inviter_id,recipient_id,inviter_email,recipient_email,purpose,policy_version,inviter_consented_at,
  recipient_consented_at,state,revision,expires_at,created_at,updated_at) on public.trusted_contacts to authenticated;
create policy trusted_contacts_parties on public.trusted_contacts for select to authenticated
using(auth.uid()=inviter_id or auth.uid()=recipient_id);

create view public.trusted_contact_details with(security_invoker=true) as
select id,inviter_id,recipient_id,inviter_email,recipient_email,purpose,policy_version,inviter_consented_at,recipient_consented_at,
  case when state='pending' and expires_at<=now() then 'expired' else state end state,revision,expires_at,created_at,updated_at
from public.trusted_contacts;
revoke all on public.trusted_contact_details from public,anon;
grant select on public.trusted_contact_details to authenticated,service_role;

create table public.trusted_contact_blocks (
  id uuid not null unique default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_email text not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  primary key(user_id,blocked_user_id),check(user_id<>blocked_user_id)
);
alter table public.trusted_contact_blocks enable row level security;
revoke all on public.trusted_contact_blocks from public,anon,authenticated;
grant select on public.trusted_contact_blocks to authenticated;
grant all on public.trusted_contact_blocks to service_role;
create policy trusted_contact_blocks_own on public.trusted_contact_blocks for select to authenticated using(user_id=auth.uid());

-- Party-relative export rows contain only metadata each party already sees.
-- Acceptance token digests and internal command fingerprints are never exported.
create view public.trusted_contact_export_rows with(security_invoker=true) as
select inviter_id user_id,id,recipient_id other_user_id,recipient_email other_email,'inviter'::text party,purpose,policy_version,
  inviter_consented_at own_consented_at,recipient_consented_at other_consented_at,state,revision,expires_at,created_at,updated_at from public.trusted_contact_details
union all
select recipient_id,id,inviter_id,inviter_email,'recipient',purpose,policy_version,
  recipient_consented_at,inviter_consented_at,state,revision,expires_at,created_at,updated_at from public.trusted_contact_details;
revoke all on public.trusted_contact_export_rows from public,anon;
grant select on public.trusted_contact_export_rows to authenticated,service_role;

create function kova_private.lock_trusted_contact_pair(p_one uuid,p_two uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(least(p_one,p_two)::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_one,p_two)::text,20260903204500));
end $$;
revoke all on function kova_private.lock_trusted_contact_pair(uuid,uuid) from public,anon,authenticated;
grant execute on function kova_private.lock_trusted_contact_pair(uuid,uuid) to service_role;

create function public.create_trusted_contact_invitation(p_actor uuid,p_actor_email text,p_recipient_email text,p_id uuid,p_consent boolean,p_policy text)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare recipient uuid;existing public.trusted_contacts%rowtype;
begin
  if p_actor is null or p_id is null or p_consent is distinct from true or p_policy is distinct from 'trusted-contact-consent-v1'
    or kova_private.verified_auth_user_for_email(p_actor_email) is distinct from p_actor then raise exception 'trusted_contact_unavailable'; end if;
  -- The API charges a distributed attempt limit BEFORE any recipient lookup.
  recipient:=kova_private.verified_auth_user_for_email(p_recipient_email);
  if recipient is null or recipient=p_actor then raise exception 'trusted_contact_unavailable'; end if;
  perform kova_private.lock_trusted_contact_pair(p_actor,recipient);
  if exists(select 1 from public.account_deletion_fences where user_id in(p_actor,recipient)) then raise exception 'trusted_contact_unavailable'; end if;
  select * into existing from public.trusted_contacts where id=p_id;
  if existing.id is not null then
    if existing.inviter_id<>p_actor or existing.recipient_id<>recipient then raise exception 'trusted_contact_unavailable'; end if;
    return jsonb_build_object('id',existing.id,'revision',existing.revision,'state',existing.state);
  end if;
  if exists(select 1 from public.trusted_contact_blocks where (user_id=p_actor and blocked_user_id=recipient) or(user_id=recipient and blocked_user_id=p_actor))
    or exists(select 1 from public.trusted_contacts where ((inviter_id=p_actor and recipient_id=recipient)or(inviter_id=recipient and recipient_id=p_actor))
      and(state='accepted' or(state='pending' and expires_at>now())))
    or exists(select 1 from public.trusted_contacts where inviter_id=p_actor and created_at>now()-interval '1 minute')
    or (select count(*) from public.trusted_contacts where inviter_id=p_actor and created_at>now()-interval '1 day')>=5
    or (select count(*) from public.trusted_contacts where inviter_id=p_actor and state='pending' and expires_at>now())>=3
    or (select count(*) from public.trusted_contacts where recipient_id=recipient and state='pending' and expires_at>now())>=10
    or (select count(*) from public.trusted_contacts where (inviter_id=p_actor or recipient_id=p_actor) and state='accepted')>=10
    or (select count(*) from public.trusted_contacts where (inviter_id=recipient or recipient_id=recipient) and state='accepted')>=10
    then raise exception 'trusted_contact_unavailable'; end if;
  insert into public.trusted_contacts(id,inviter_id,recipient_id,inviter_email,recipient_email,policy_version)
    values(p_id,p_actor,recipient,lower(btrim(p_actor_email)),lower(btrim(p_recipient_email)),p_policy);
  return jsonb_build_object('id',p_id,'revision',1,'state','pending');
end $$;

create function public.command_trusted_contact(p_actor uuid,p_id uuid,p_revision bigint,p_action text,p_command uuid,p_token_digest text default null,p_consent boolean default false)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare contact public.trusted_contacts%rowtype;other_id uuid;fingerprint text;
begin
  if p_actor is null or p_id is null or p_revision is null or p_revision<1 or p_command is null or p_action is null or p_action not in('review','accept','decline','revoke','block','remove') then raise exception 'trusted_contact_unavailable'; end if;
  select * into contact from public.trusted_contacts where id=p_id;
  if contact.id is null or p_actor not in(contact.inviter_id,contact.recipient_id) then raise exception 'trusted_contact_unavailable'; end if;
  perform kova_private.lock_trusted_contact_pair(contact.inviter_id,contact.recipient_id);
  select * into contact from public.trusted_contacts where id=p_id for update;
  if contact.id is null then raise exception 'trusted_contact_unavailable'; end if;
  fingerprint:=md5(p_action||':'||coalesce(p_token_digest,'')||':'||coalesce(p_consent,false)::text);
  if contact.last_command_id=p_command and contact.last_actor_id=p_actor then
    if contact.last_fingerprint<>fingerprint then raise exception 'trusted_contact_unavailable'; end if;
    return jsonb_build_object('id',contact.id,'revision',contact.revision,'state',contact.state,'replayed',true);
  end if;
  if contact.revision<>p_revision then raise exception 'trusted_contact_conflict'; end if;
  other_id:=case when p_actor=contact.inviter_id then contact.recipient_id else contact.inviter_id end;
  if p_action in('review','accept') then
    if p_actor<>contact.recipient_id or contact.state<>'pending' or contact.expires_at<=now()
      or exists(select 1 from public.account_deletion_fences where user_id in(contact.inviter_id,contact.recipient_id))
      or kova_private.verified_auth_user_for_email(contact.inviter_email) is distinct from contact.inviter_id
      or kova_private.verified_auth_user_for_email(contact.recipient_email) is distinct from contact.recipient_id
      or exists(select 1 from public.trusted_contact_blocks where (user_id=p_actor and blocked_user_id=other_id)or(user_id=other_id and blocked_user_id=p_actor)) then raise exception 'trusted_contact_unavailable'; end if;
  end if;
  if p_action='review' then
    if p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$'
      or (contact.token_expires_at is not null and contact.token_expires_at>now()+interval '9 minutes 55 seconds') then raise exception 'trusted_contact_unavailable'; end if;
    update public.trusted_contacts set token_digest=p_token_digest,token_expires_at=now()+interval '10 minutes' where id=p_id;
  elsif p_action='accept' then
    if p_consent is distinct from true or p_token_digest is null or contact.token_digest is distinct from p_token_digest
      or contact.token_expires_at is null or contact.token_expires_at<=now()
      or (select count(*) from public.trusted_contacts where(inviter_id=p_actor or recipient_id=p_actor)and state='accepted')>=10
      or (select count(*) from public.trusted_contacts where(inviter_id=other_id or recipient_id=other_id)and state='accepted')>=10 then raise exception 'trusted_contact_unavailable'; end if;
    update public.trusted_contacts set state='accepted',recipient_consented_at=now(),token_digest=null,token_expires_at=null where id=p_id;
  elsif p_action='decline' then
    if p_actor<>contact.recipient_id or contact.state<>'pending' then raise exception 'trusted_contact_unavailable'; end if;
    update public.trusted_contacts set state='declined',token_digest=null,token_expires_at=null where id=p_id;
  elsif p_action='revoke' then
    if contact.state<>'accepted' and not(contact.state='pending' and p_actor=contact.inviter_id) then raise exception 'trusted_contact_unavailable'; end if;
    update public.trusted_contacts set state='revoked',token_digest=null,token_expires_at=null where id=p_id;
  elsif p_action='block' then
    insert into public.trusted_contact_blocks(user_id,blocked_user_id,blocked_email) values(p_actor,other_id,case when p_actor=contact.inviter_id then contact.recipient_email else contact.inviter_email end)
      on conflict(user_id,blocked_user_id) do update set revision=public.trusted_contact_blocks.revision+1;
    update public.trusted_contacts set state='revoked',token_digest=null,token_expires_at=null,revision=revision+1,updated_at=now()
      where id<>p_id and((inviter_id=p_actor and recipient_id=other_id)or(inviter_id=other_id and recipient_id=p_actor)) and state in('pending','accepted');
    update public.trusted_contacts set state='revoked',token_digest=null,token_expires_at=null where id=p_id;
  elsif p_action='remove' then
    if contact.state='accepted' or(contact.state='pending' and contact.expires_at>now()) then raise exception 'trusted_contact_unavailable'; end if;
    delete from public.trusted_contacts where id=p_id;
    return jsonb_build_object('id',p_id,'removed',true);
  end if;
  update public.trusted_contacts set revision=revision+1,updated_at=now(),last_command_id=p_command,last_actor_id=p_actor,last_action=p_action,last_fingerprint=fingerprint
    where id=p_id returning * into contact;
  return jsonb_build_object('id',contact.id,'revision',contact.revision,'state',contact.state);
end $$;

create function public.unblock_trusted_contact(p_actor uuid,p_other uuid,p_revision bigint,p_block_id uuid)
returns boolean language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
begin
  if p_actor is null or p_other is null or p_actor=p_other or p_revision is null or p_revision<1 or p_block_id is null then raise exception 'trusted_contact_unavailable'; end if;
  perform kova_private.lock_trusted_contact_pair(p_actor,p_other);
  if not exists(select 1 from public.trusted_contact_blocks where user_id=p_actor and blocked_user_id=p_other) then return true; end if;
  delete from public.trusted_contact_blocks where user_id=p_actor and blocked_user_id=p_other and revision=p_revision and id=p_block_id;
  if not found then raise exception 'trusted_contact_conflict'; end if;
  return true;
end $$;

create function kova_private.fence_trusted_contacts() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update public.trusted_contacts set state='revoked',revision=revision+1,token_digest=null,token_expires_at=null,updated_at=now(),
    last_command_id=null,last_actor_id=null,last_action=null,last_fingerprint=null where inviter_id=new.user_id or recipient_id=new.user_id;
  return new;
end $$;
revoke all on function kova_private.fence_trusted_contacts() from public,anon,authenticated;
grant execute on function kova_private.fence_trusted_contacts() to service_role;
create trigger trusted_contacts_account_fence after insert or update on public.account_deletion_fences for each row execute function kova_private.fence_trusted_contacts();
revoke all on function public.create_trusted_contact_invitation(uuid,text,text,uuid,boolean,text),
  public.command_trusted_contact(uuid,uuid,bigint,text,uuid,text,boolean),public.unblock_trusted_contact(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.create_trusted_contact_invitation(uuid,text,text,uuid,boolean,text),
  public.command_trusted_contact(uuid,uuid,bigint,text,uuid,text,boolean),public.unblock_trusted_contact(uuid,uuid,bigint,uuid) to service_role;
