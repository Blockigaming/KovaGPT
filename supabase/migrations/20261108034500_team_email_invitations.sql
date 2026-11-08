-- Email invitations reserve paid capacity before a recipient has an account.
-- Service-only operations; verified actor IDs come from the authenticated server.
create table public.team_email_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.team_workspaces(id) on delete cascade,
  email text not null check (email=lower(btrim(email)) and char_length(email) between 3 and 254),
  seat text not null check(seat in ('standard','premium')),
  state text not null default 'draft' check(state in ('draft','billing','invited','accepted','canceled')),
  subscription_id text not null,
  base_standard integer not null,
  base_premium integer not null,
  target_standard integer not null,
  target_premium integer not null,
  needs_seat boolean not null,
  proration_date bigint not null,
  quote jsonb,
  email_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  dispatched_at timestamptz,
  invoice_id text,
  mail_started_at timestamptz,
  mail_lease_until timestamptz,
  mail_sent_at timestamptz,
  provider_id text,
  accepted_by uuid references auth.users(id) on delete set null,
  check(base_standard>=0 and base_premium>=0 and target_standard>=0 and target_premium>=0
    and target_standard+target_premium between 2 and 150)
);
alter table public.team_email_invitations enable row level security;
revoke all on public.team_email_invitations from public,anon,authenticated;
grant all on public.team_email_invitations to service_role;
create unique index team_email_invitation_recipient on public.team_email_invitations(team_id,email)
 where state in ('draft','billing','invited');
create unique index team_email_invitation_billing on public.team_email_invitations(team_id)
 where state in ('draft','billing');
create index team_email_invitation_recipient_lookup on public.team_email_invitations(email,state);

create function public.prepare_team_email_invitation(p_actor uuid,p_team uuid,p_email text,p_seat text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.team_workspaces; i public.team_email_invitations; used integer; paid integer; target uuid;
begin
 select * into t from public.team_workspaces where id=p_team for update;
 if t.id is null or t.owner_id<>p_actor or kova_private.team_verified_email(p_actor) is null
   or exists(select 1 from public.account_deletion_fences where user_id=p_actor) then raise exception 'Only a verified team owner can invite members'; end if;
 if t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now() or t.subscription_id is null then raise exception 'Complete team payment first'; end if;
 if p_email is null or p_email !~ '^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$' or char_length(p_email)>254
   or p_seat not in ('standard','premium') then raise exception 'Enter a valid email and seat type'; end if;
 p_email:=lower(btrim(p_email));
 if p_email=lower(kova_private.team_verified_email(p_actor)) then raise exception 'You already have an owner seat'; end if;
 target:=kova_private.verified_auth_user_for_email(p_email);
 if target is not null and exists(select 1 from public.team_members where team_id=t.id and user_id=target and state in ('active','invited')) then raise exception 'This person already belongs to your team'; end if;
 update public.team_email_invitations set state='canceled' where team_id=t.id and state in ('draft','invited') and expires_at<=now();
 select * into i from public.team_email_invitations where team_id=t.id and email=p_email and state in ('draft','billing','invited');
 if i.id is not null then
   if i.seat<>p_seat then raise exception 'Cancel the existing invitation before changing its seat'; end if;
   return to_jsonb(i);
 end if;
 if exists(select 1 from public.team_email_invitations where team_id=t.id and state in ('draft','billing')) then raise exception 'Finish or cancel the pending invitation first'; end if;
 select (select count(*) from public.team_members where team_id=t.id and seat=p_seat and state in ('active','invited'))+
   (select count(*) from public.team_email_invitations where team_id=t.id and seat=p_seat and state='invited') into used;
 paid:=case p_seat when 'standard' then t.standard_seats else t.premium_seats end;
 if used>paid then raise exception 'Existing invitations exceed paid capacity. Cancel unused invitations or restore seats in billing first'; end if;
 insert into public.team_email_invitations(team_id,email,seat,subscription_id,base_standard,base_premium,target_standard,target_premium,needs_seat,proration_date,email_body)
 values(t.id,p_email,p_seat,t.subscription_id,t.standard_seats,t.premium_seats,
   t.standard_seats+case when p_seat='standard' and used>=paid then 1 else 0 end,
   t.premium_seats+case when p_seat='premium' and used>=paid then 1 else 0 end,
   used>=paid,floor(extract(epoch from now())),p_body) returning * into i;
 return to_jsonb(i);
end $$;

create function public.claim_team_email_invitation(p_actor uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.team_email_invitations; t public.team_workspaces;
begin
 select * into i from public.team_email_invitations where id=p_id;
 select * into t from public.team_workspaces where id=i.team_id for update;
 select * into i from public.team_email_invitations where id=p_id for update;
 if t.owner_id is distinct from p_actor or kova_private.team_verified_email(p_actor) is null
   or exists(select 1 from public.account_deletion_fences where user_id=p_actor) then raise exception 'Only the team owner can send this invitation'; end if;
 if t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now() then raise exception 'Resolve billing before sending invitations'; end if;
 if i.state='draft' then
   if i.expires_at<=now() or i.quote is null then raise exception 'The price review expired. Review the invitation again'; end if;
   if t.subscription_id<>i.subscription_id or t.standard_seats<>i.base_standard or t.premium_seats<>i.base_premium then raise exception 'Team seats changed. Cancel this review and try again'; end if;
   update public.team_email_invitations set state='billing',dispatched_at=now() where id=i.id returning * into i;
 end if;
 if i.state not in ('billing','invited','accepted') then raise exception 'This invitation is no longer available'; end if;
 return to_jsonb(i);
end $$;

create function public.finalize_team_email_invitation(p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare i public.team_email_invitations; t public.team_workspaces; used integer; paid integer;
begin
 select * into i from public.team_email_invitations where id=p_id;
 select * into t from public.team_workspaces where id=i.team_id for update;
 select * into i from public.team_email_invitations where id=p_id for update;
 if i.state in ('invited','accepted') then return true; end if;
 if i.state<>'billing' or t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now()
   or t.subscription_id<>i.subscription_id or t.standard_seats<i.target_standard or t.premium_seats<i.target_premium
   or exists(select 1 from public.account_deletion_fences where user_id=t.owner_id) then return false; end if;
 select (select count(*) from public.team_members where team_id=t.id and seat=i.seat and state in ('active','invited'))+
   (select count(*) from public.team_email_invitations where team_id=t.id and seat=i.seat and state='invited') into used;
 paid:=case i.seat when 'standard' then t.standard_seats else t.premium_seats end;
 if used>=paid then return false; end if;
 update public.team_email_invitations set state='invited',expires_at=now()+interval '30 days' where id=i.id;
 return true;
end $$;

create function public.manage_team_email_invitation(p_actor uuid,p_id uuid,p_action text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare i public.team_email_invitations; t public.team_workspaces; email text; used integer; paid integer;
begin
 select * into i from public.team_email_invitations where id=p_id;
 select * into t from public.team_workspaces where id=i.team_id for update;
 select * into i from public.team_email_invitations where id=p_id for update;
 email:=lower(kova_private.team_verified_email(p_actor));
 if email is null or exists(select 1 from public.account_deletion_fences where user_id=p_actor) then raise exception 'Verify your email before managing an invitation'; end if;
 if p_action='cancel' and t.owner_id=p_actor then
   if i.state='billing' then raise exception 'Billing has started. Finish payment or contact support before canceling'; end if;
   update public.team_email_invitations set state='canceled' where id=i.id and state in ('draft','invited');
   return found;
 end if;
 if p_action<>'accept' or i.email<>email then raise exception 'Sign in with the invited email to accept'; end if;
 if i.state='accepted' and i.accepted_by=p_actor then return true; end if;
 if i.state<>'invited' or i.expires_at<=now() or t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now()
   or exists(select 1 from public.account_deletion_fences where user_id=t.owner_id) then raise exception 'This invitation or team subscription is no longer active'; end if;
 select count(*) into used from public.team_members where team_id=t.id and seat=i.seat and state in ('active','invited') and user_id<>p_actor;
 paid:=case i.seat when 'standard' then t.standard_seats else t.premium_seats end;
 if used>=paid then raise exception 'The team owner needs to restore paid seat capacity'; end if;
 insert into public.team_members(team_id,user_id,email,seat,state) values(t.id,p_actor,email,i.seat,'active')
 on conflict(team_id,user_id) do update set email=excluded.email,seat=excluded.seat,state='active',joined_at=now();
 update public.team_email_invitations set state='accepted',accepted_by=p_actor where id=i.id;
 return true;
end $$;

create function public.list_team_email_invitations(p_actor uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'teamId',i.team_id,'name',t.name,'seat',i.seat)),'[]'::jsonb)
 from public.team_email_invitations i join public.team_workspaces t on t.id=i.team_id
 where i.email=lower(kova_private.team_verified_email(p_actor)) and i.state='invited' and i.expires_at>now()
 and not t.billing_hold and t.status in ('active','trialing') and t.paid_until>now()
 and not exists(select 1 from public.account_deletion_fences where user_id in (p_actor,t.owner_id))
$$;

create function public.claim_team_invitation_email(p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.team_email_invitations; t public.team_workspaces;
begin
 select * into i from public.team_email_invitations where id=p_id;
 select * into t from public.team_workspaces where id=i.team_id for update;
 select * into i from public.team_email_invitations where id=p_id for update;
 if i.state<>'invited' or i.mail_sent_at is not null or i.expires_at<=now() or i.mail_lease_until>now()
   or i.mail_started_at<now()-interval '23 hours' or t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now()
   or exists(select 1 from public.account_deletion_fences where user_id=t.owner_id) then return null; end if;
 update public.team_email_invitations set mail_started_at=coalesce(mail_started_at,now()),mail_lease_until=now()+interval '60 seconds' where id=i.id returning * into i;
 return to_jsonb(i);
end $$;

revoke all on function public.prepare_team_email_invitation(uuid,uuid,text,text,jsonb),
 public.claim_team_email_invitation(uuid,uuid),public.finalize_team_email_invitation(uuid),
 public.manage_team_email_invitation(uuid,uuid,text),public.list_team_email_invitations(uuid),public.claim_team_invitation_email(uuid)
 from public,anon,authenticated;
grant execute on function public.prepare_team_email_invitation(uuid,uuid,text,text,jsonb),
 public.claim_team_email_invitation(uuid,uuid),public.finalize_team_email_invitation(uuid),
 public.manage_team_email_invitation(uuid,uuid,text),public.list_team_email_invitations(uuid),public.claim_team_invitation_email(uuid)
 to service_role;
