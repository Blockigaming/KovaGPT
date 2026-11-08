begin;
create table public.team_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 100),
  customer_id text unique,
  subscription_id text unique,
  status text not null default 'pending',
  billing_hold boolean not null default false,
  standard_seats integer not null default 0 check(standard_seats between 0 and 150),
  premium_seats integer not null default 0 check(premium_seats between 0 and 150),
  paid_until timestamptz,
  checkout_generation uuid not null default gen_random_uuid(),
  checkout_config jsonb,
  checkout_session text unique,
  checkout_started_at timestamptz not null default now(),
  observed_at timestamptz,
  constraint team_seat_cap check(standard_seats + premium_seats <= 150)
);
create table public.team_members (
  team_id uuid not null references public.team_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '' check(char_length(email)<=254),
  seat text not null check(seat in ('standard','premium')),
  state text not null check(state in ('invited','active','removed')),
  joined_at timestamptz not null default now(),
  primary key(team_id,user_id)
);
alter table public.team_workspaces enable row level security;
alter table public.team_members enable row level security;
revoke all on public.team_workspaces, public.team_members from public, anon, authenticated;
grant all on public.team_workspaces, public.team_members to service_role;

-- Prefer the adopted Kova identity over its retained hosted-auth mirror.
create function kova_private.team_verified_email(p_user uuid) returns text
language sql stable security invoker set search_path='' as $$
 select public.kova_auth_directory_email(p_user)
$$;
revoke all on function kova_private.team_verified_email(uuid) from public,anon,authenticated;
grant execute on function kova_private.team_verified_email(uuid) to service_role;

-- Verified identity comes only from the server. Serialize seat reservations on the workspace.
create function public.mutate_team_member(p_actor uuid, p_team uuid, p_action text, p_email text default null, p_user uuid default null, p_seat text default 'standard')
returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.team_workspaces; target uuid; seats integer; used integer;
begin
 select * into t from public.team_workspaces where id=p_team for update;
 if t.id is null then raise exception 'Team unavailable'; end if;
 if kova_private.team_verified_email(p_actor) is null
   or exists(select 1 from public.account_deletion_fences where user_id=p_actor) then raise exception 'Verified login required'; end if;
 if p_action='accept' then
   if t.billing_hold or t.status not in ('active','trialing') or t.paid_until<=now() then raise exception 'Team subscription is not active'; end if;
   update public.team_members set state='active' where team_id=t.id and user_id=p_actor and state='invited';
   return found;
 end if;
 if t.owner_id<>p_actor then raise exception 'Only the team owner can manage seats'; end if;
 if p_action='remove' then
   if p_user=t.owner_id then raise exception 'The owner seat cannot be removed'; end if;
   update public.team_members set state='removed' where team_id=t.id and user_id=p_user;
   return found;
 end if;
 if p_action<>'invite' or p_seat not in ('standard','premium') then raise exception 'Invalid team action'; end if;
 if t.billing_hold or t.status not in ('active','trialing') or t.paid_until is null or t.paid_until<=now() then raise exception 'Complete team payment first'; end if;
 target:=kova_private.verified_auth_user_for_email(p_email);
 if target is null or lower(kova_private.team_verified_email(target)) is distinct from lower(btrim(p_email)) or exists(select 1 from public.account_deletion_fences where user_id=target) then raise exception 'The recipient needs a verified KovaGPT account'; end if;
 if exists(select 1 from public.team_members where team_id=t.id and user_id=target and state in ('active','invited')) then return true; end if;
 select count(*) into used from public.team_members where team_id=t.id and seat=p_seat and state in ('active','invited');
 seats:=case p_seat when 'standard' then t.standard_seats else t.premium_seats end;
 if used>=seats then raise exception 'No unassigned seats of this type. Add seats in billing first'; end if;
 insert into public.team_members(team_id,user_id,email,seat,state) values(t.id,target,lower(btrim(p_email)),p_seat,'invited')
 on conflict(team_id,user_id) do update set email=excluded.email,seat=excluded.seat,state='invited',joined_at=now();
 return true;
end $$;
revoke all on function public.mutate_team_member(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.mutate_team_member(uuid,uuid,text,text,uuid,text) to service_role;

create function public.reconcile_team_subscription(p_team uuid,p_customer text,p_subscription text,p_status text,p_standard integer,p_premium integer,p_until timestamptz,p_observed timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.team_workspaces;
begin
 select * into t from public.team_workspaces where id=p_team for update;
 if t.id is null or t.customer_id is distinct from p_customer then raise exception 'Team billing identity mismatch'; end if;
 if t.observed_at is not null and t.observed_at>p_observed then return false; end if;
 update public.team_workspaces set subscription_id=p_subscription,status=p_status,standard_seats=p_standard,premium_seats=p_premium,paid_until=p_until,observed_at=p_observed where id=t.id;
 if p_status in ('active','trialing') and p_until>now() then
   insert into public.team_members(team_id,user_id,email,seat,state)
   values(t.id,t.owner_id,coalesce(kova_private.team_verified_email(t.owner_id),''),case when p_standard>0 then 'standard' else 'premium' end,'active')
   on conflict(team_id,user_id) do update set state='active',seat=excluded.seat;
   -- Portal downgrades must never leave more active/reserved seats than were paid for.
   with ranked as (
     select user_id,seat,row_number() over(partition by seat order by (user_id=t.owner_id) desc,(state='active') desc,joined_at,user_id) n
     from public.team_members where team_id=t.id and state in ('invited','active')
   ) update public.team_members m set state='removed' from ranked r where m.team_id=t.id and m.user_id=r.user_id
     and r.n>case r.seat when 'standard' then p_standard else p_premium end;
 end if;
 return true;
end $$;
revoke all on function public.reconcile_team_subscription(uuid,text,text,text,integer,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_team_subscription(uuid,text,text,text,integer,integer,timestamptz,timestamptz) to service_role;

-- Extend the established entitlement authority; retain personal/family resolution.
create or replace function public.effective_user_plan_tier(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with own_resolution as (
    select
      public.billing_user_plan_tier(_user_id) as tier,
      (
        select count(*)
        from public.subscriptions as subscription
        where subscription.user_id = _user_id
          and subscription.environment = 'live'
          and (
            (
              subscription.status in ('active', 'trialing', 'past_due')
              and (
                subscription.current_period_end > now()
              )
            )
            or (
              subscription.status = 'canceled'
              and subscription.current_period_end > now()
            )
          )
      ) as active_subscription_count
  ),
  principal_tiers as (
    select own.tier
    from own_resolution as own
    union all
    select public.billing_user_plan_tier(public.family_owner_of(_user_id))
    where public.family_owner_of(_user_id) is not null
    union all
    select 'pro' from public.team_members m join public.team_workspaces t on t.id=m.team_id
      where m.user_id=_user_id and m.state='active' and not t.billing_hold and t.status in ('active','trialing') and t.paid_until>now()
        and not exists(select 1 from public.account_deletion_fences f where f.user_id=_user_id)
  )
  select case
    when own.active_subscription_count > 0 and own.tier = 'free'
      then 'free'
    when bool_or(principal.tier = 'pro') then 'pro'
    when bool_or(principal.tier = 'plus') then 'plus'
    else 'free'
  end
  from own_resolution as own
  cross join principal_tiers as principal
  group by own.active_subscription_count, own.tier;
$$;

revoke execute on function public.effective_user_plan_tier(uuid)
  from public, anon, authenticated;
grant execute on function public.effective_user_plan_tier(uuid)
  to service_role;


-- Serialize Team customer/session binding with the finalization fence. A pre-fence
-- remote request can never attach a new billable identity after the deletion snapshot.
create function kova_private.guard_team_billing_finalization() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=new.owner_id for update;
  if exists(select 1 from public.account_deletion_fences where user_id=new.owner_id) then
    raise exception 'Account deletion has started. Team checkout is unavailable';
  end if;
  return new;
end $$;
revoke all on function kova_private.guard_team_billing_finalization() from public,anon,authenticated;
create trigger guard_team_checkout_insert before insert on public.team_workspaces
  for each row execute function kova_private.guard_team_billing_finalization();
create trigger guard_team_checkout_binding before update of owner_id,customer_id,checkout_generation,checkout_config,checkout_session on public.team_workspaces
  for each row execute function kova_private.guard_team_billing_finalization();
create function kova_private.lock_team_finalization_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=new.user_id for update;
  return new;
end $$;
revoke all on function kova_private.lock_team_finalization_owner() from public,anon,authenticated;
create trigger lock_team_finalization_owner before insert on public.account_deletion_fences
  for each row execute function kova_private.lock_team_finalization_owner();
commit;
