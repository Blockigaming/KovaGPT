-- Staged developer credit-lot engine. Deliberately not enabled or wired to the
-- existing aggregate balance. Materialize and replay with the funding/admission
-- integration before activation. All amounts use the existing minor-unit scale 8.
-- Server-only routines; no caller-supplied subscription tier or payment amount.
create table public.developer_credit_lots_v2 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.developer_credit_accounts(id),
  kind text not null check(kind in ('purchased','included_pro')),
  source_key text not null check(length(source_key) between 1 and 200),
  owner_id uuid not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>issued_at),
  issued_amount numeric(20,8) not null check(issued_amount>0),
  available_amount numeric(20,8) not null check(available_amount>=0),
  held_amount numeric(20,8) not null default 0 check(held_amount>=0),
  spent_amount numeric(20,8) not null default 0 check(spent_amount>=0),
  expired_amount numeric(20,8) not null default 0 check(expired_amount>=0),
  reversed_amount numeric(20,8) not null default 0 check(reversed_amount>=0),
  unique(kind,source_key),
  unique(id,account_id),
  check(available_amount+held_amount+spent_amount+expired_amount+reversed_amount=issued_amount)
);
create index developer_credit_lots_v2_spend_idx on public.developer_credit_lots_v2(account_id,kind,expires_at,id);
create table public.developer_credit_holds_v2 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.developer_credit_accounts(id),
  owner_id uuid not null,
  request_key text not null check(length(request_key) between 1 and 200),
  surface text not null check(surface in ('api','consumer')),
  reserved_amount numeric(20,8) not null check(reserved_amount>0),
  final_amount numeric(20,8) check(final_amount>=0 and final_amount<=reserved_amount),
  state text not null default 'reserved' check(state in ('reserved','dispatched','settled','released','uncertain')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique(account_id,request_key),
  unique(id,account_id),
  check((state in ('settled','released'))=(final_amount is not null and finished_at is not null))
);
create table public.developer_credit_hold_lots_v2 (
  hold_id uuid not null,
  lot_id uuid not null,
  account_id uuid not null,
  sequence integer not null check(sequence>0),
  reserved_amount numeric(20,8) not null check(reserved_amount>0),
  charged_amount numeric(20,8) check(charged_amount>=0 and charged_amount<=reserved_amount),
  primary key(hold_id,lot_id),
  unique(hold_id,sequence),
  foreign key(hold_id,account_id) references public.developer_credit_holds_v2(id,account_id),
  foreign key(lot_id,account_id) references public.developer_credit_lots_v2(id,account_id)
);
-- A reversal that exceeds unused value is a reconciliation liability, not
-- permission to debit an unrelated customer's or included-credit balance.
create table public.developer_credit_reversals_v2 (
  lot_id uuid primary key references public.developer_credit_lots_v2(id),
  target_amount numeric(20,8) not null check(target_amount>=0),
  unresolved_amount numeric(20,8) not null check(unresolved_amount>=0),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.developer_credit_lots_v2 enable row level security;
alter table public.developer_credit_holds_v2 enable row level security;
alter table public.developer_credit_hold_lots_v2 enable row level security;
alter table public.developer_credit_reversals_v2 enable row level security;
revoke all on public.developer_credit_lots_v2,public.developer_credit_holds_v2,
 public.developer_credit_hold_lots_v2,public.developer_credit_reversals_v2 from public,anon,authenticated;
grant select,insert,update on public.developer_credit_lots_v2,public.developer_credit_holds_v2,
 public.developer_credit_hold_lots_v2,public.developer_credit_reversals_v2 to service_role;

create function public.developer_credit_expire_v2(p_account uuid,p_at timestamptz)
returns numeric language plpgsql security invoker set search_path='' as $$
declare result numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if p_at is null or not isfinite(p_at) then raise exception 'developer_credit_date_invalid';end if;
  with due as (
    select id,available_amount from public.developer_credit_lots_v2
    where account_id=p_account and expires_at<=p_at and available_amount>0 for update
  ), changed as (
    update public.developer_credit_lots_v2 l
      set expired_amount=l.expired_amount+due.available_amount,available_amount=0
      from due where l.id=due.id returning due.available_amount
  ) select coalesce(sum(available_amount),0) into result from changed;
  return result;
end $$;

-- Paid subscription authority, not client metadata. Direct active personal Pro
-- only, with an unexpired live monthly period. Excludes trialing and team/family
-- entitlements. Require canonical tier and a real mapped price.
create function public.developer_pro_period_v2(p_owner uuid,p_at timestamptz)
returns table(period_start timestamptz,period_end timestamptz)
language sql stable security invoker set search_path='' as $$
  select s.current_period_start,s.current_period_end
  from public.subscriptions s
  join public.billing_plan_tiers t on t.environment=s.environment and t.stripe_price_id=s.price_id
  where s.user_id=p_owner and s.environment='live' and s.status='active'
    and t.tier='pro' and t.lookup_key='pro_monthly'
    and s.current_period_start<=p_at and s.current_period_end>p_at
    and s.current_period_end<=s.current_period_start+interval '32 days'
    and public.billing_user_plan_tier(p_owner)='pro'
  order by s.current_period_start desc,s.id limit 1
$$;

-- Refresh one non-overlapping allowance per user. No new grant from switching
-- workspaces, changing price, retrying, or concurrent requests. Expire unused
-- included funds when eligibility ends; existing holds retain their provenance.
create function public.developer_refresh_pro_v2(p_owner uuid,p_at timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a uuid; l uuid; start_at timestamptz; end_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
    then raise exception 'developer_owner_required' using errcode='42501';end if;
  select period_start,period_end into start_at,end_at from public.developer_pro_period_v2(p_owner,p_at);
  if start_at is null then
    update public.developer_credit_lots_v2 set expired_amount=expired_amount+available_amount,available_amount=0
      where owner_id=p_owner and kind='included_pro' and available_amount>0;
    return null;
  end if;
  update public.developer_credit_lots_v2 set expired_amount=expired_amount+available_amount,available_amount=0
    where owner_id=p_owner and kind='included_pro' and available_amount>0
      and (issued_at<>start_at or expires_at<=p_at);
  select id into l from public.developer_credit_lots_v2 where owner_id=p_owner and kind='included_pro'
    and issued_at<end_at and expires_at>start_at order by issued_at limit 1;
  if found then return l;end if;
  select own.account_id into a from public.developer_account_owners own
    join public.developer_credit_accounts acc on acc.id=own.account_id
    where own.owner_id=p_owner and acc.currency='USD' and acc.suspended_at is null
    order by own.created_at,own.account_id limit 1;
  if a is null then return null;end if;
  insert into public.developer_credit_lots_v2(account_id,kind,source_key,owner_id,issued_at,expires_at,issued_amount,available_amount)
    values(a,'included_pro',p_owner::text||':'||extract(epoch from start_at)::text,p_owner,start_at,end_at,8000,8000)
    returning id into l;
  return l;
end $$;

-- Record a confirmed processor receipt exactly once. The receipt, amount,
-- original purchase time and owner all come from the existing funding tables.
-- Never derive expiry from login time or a later purchase.
create function public.developer_record_purchase_v2(p_attempt uuid,p_charge text,p_paid_at timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare item record; lot public.developer_credit_lots_v2%rowtype; expiry timestamptz;
  target numeric; delta numeric; from_available numeric; from_expired numeric; unresolved numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select f.account_id,own.owner_id,p.id purchase_id,p.credits_granted,
    r.charge_id,r.reversal_amount into item
    from public.developer_funding_receipts r
    join public.developer_funding_attempts f on f.id=r.attempt_id
    join public.credit_purchases p on p.id=r.purchase_id and p.account_id=f.account_id
    join public.developer_account_owners own on own.account_id=f.account_id
    where r.attempt_id=p_attempt and f.state='paid';
  if not found or p_charge is distinct from item.charge_id
    then raise exception 'developer_credit_receipt_required';end if;
  if p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>clock_timestamp()
    then raise exception 'developer_credit_purchase_time_unverified';end if;
  if item.credits_granted<=0 then raise exception 'developer_credit_amount_invalid';end if;
  expiry:=((p_paid_at at time zone 'UTC')+interval '1 year') at time zone 'UTC';
  select * into lot from public.developer_credit_lots_v2
    where kind='purchased' and source_key=item.purchase_id::text for update;
  if not found then
    insert into public.developer_credit_lots_v2(account_id,kind,source_key,owner_id,issued_at,expires_at,issued_amount,available_amount)
      values(item.account_id,'purchased',item.purchase_id::text,item.owner_id,p_paid_at,expiry,item.credits_granted,item.credits_granted)
      returning * into lot;
  elsif lot.account_id<>item.account_id or lot.issued_at<>p_paid_at
    or lot.issued_amount<>item.credits_granted then
    raise exception 'developer_credit_receipt_conflict';
  end if;
  target:=item.reversal_amount;
  if target is null or target<0 or target>lot.issued_amount then raise exception 'developer_credit_reversal_invalid';end if;
  -- A reversal removes unused value only from the original purchase. Spent
  -- and held value cannot be silently reclaimed. An unresolved liability
  -- blocks new reservations until reconciliation. Refund/dispute recovery
  -- restores only the amount previously reversed, never resets expiry.
  delta:=target-lot.reversed_amount;
  if delta>0 then
    from_available:=least(delta,lot.available_amount);
    from_expired:=least(delta-from_available,lot.expired_amount);
    update public.developer_credit_lots_v2 set available_amount=available_amount-from_available,
      expired_amount=expired_amount-from_expired,reversed_amount=reversed_amount+from_available+from_expired
      where id=lot.id returning * into lot;
  elsif delta<0 then
    update public.developer_credit_lots_v2 set reversed_amount=reversed_amount+delta,
      available_amount=available_amount+case when expires_at>clock_timestamp() then -delta else 0 end,
      expired_amount=expired_amount+case when expires_at<=clock_timestamp() then -delta else 0 end
      where id=lot.id returning * into lot;
  end if;
  unresolved:=greatest(0,target-lot.reversed_amount);
  insert into public.developer_credit_reversals_v2(lot_id,target_amount,unresolved_amount)
    values(lot.id,target,unresolved) on conflict(lot_id) do update set
    target_amount=excluded.target_amount,unresolved_amount=excluded.unresolved_amount,updated_at=clock_timestamp();
  perform public.developer_credit_expire_v2(item.account_id,clock_timestamp());
  return lot.id;
end $$;

-- Reservation and terminal settlement are transactional and lock the same
-- global billing lock as existing API metering. Allocation order is immutable.
-- Consumer callers MUST first exhaust their ordinary consumer allowance and
-- wallet, verify the canonical quote and spending caps, and only then call
-- this routine through the consumer billing integration.
create function public.developer_reserve_lots_v2(
  p_owner uuid,p_account uuid,p_request text,p_surface text,p_amount numeric,p_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.developer_credit_holds_v2%rowtype; l record; take_amount numeric; remaining numeric; seq integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if p_surface is null or p_surface not in ('api','consumer') or p_request is null or length(p_request) not between 1 and 200
    or p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,8)
    or p_at is null or not isfinite(p_at) then raise exception 'developer_credit_request_invalid';end if;
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
    or not exists(select 1 from public.developer_account_owners own join public.developer_credit_accounts a on a.id=own.account_id
      where own.owner_id=p_owner and own.account_id=p_account and a.suspended_at is null)
    then raise exception 'developer_owner_required' using errcode='42501';end if;
  select * into r from public.developer_credit_holds_v2 where account_id=p_account and request_key=p_request;
  if found then
    if r.owner_id<>p_owner or r.surface<>p_surface or r.reserved_amount<>p_amount
      then raise exception 'developer_credit_request_conflict';end if;
    return jsonb_build_object('decision','duplicate','holdId',r.id,'state',r.state);
  end if;
  if p_surface='consumer' and not exists(select 1 from public.developer_credit_sharing_preferences
    where owner_id=p_owner and allow_consumer_usage)
    then raise exception 'developer_credit_sharing_disabled';end if;
  if exists(select 1 from public.developer_credit_reversals_v2 x join public.developer_credit_lots_v2 lot on lot.id=x.lot_id
    where lot.account_id=p_account and x.unresolved_amount>0)
    then raise exception 'developer_credit_reconciliation_required';end if;
  perform public.developer_credit_expire_v2(p_account,p_at);
  if p_surface='api' then perform public.developer_refresh_pro_v2(p_owner,p_at);end if;
  insert into public.developer_credit_holds_v2(account_id,owner_id,request_key,surface,reserved_amount)
    values(p_account,p_owner,p_request,p_surface,p_amount) returning * into r;
  remaining:=p_amount;
  for l in select * from public.developer_credit_lots_v2
    where account_id=p_account and owner_id=p_owner and expires_at>p_at and available_amount>0
      and (kind='purchased' or (p_surface='api' and exists(
        select 1 from public.developer_pro_period_v2(p_owner,p_at) p where p.period_start=issued_at)))
    order by (kind<>'included_pro'),expires_at,id for update loop
    take_amount:=least(l.available_amount,remaining);seq:=seq+1;
    update public.developer_credit_lots_v2 set available_amount=available_amount-take_amount,
      held_amount=held_amount+take_amount where id=l.id;
    insert into public.developer_credit_hold_lots_v2(hold_id,lot_id,account_id,sequence,reserved_amount)
      values(r.id,l.id,p_account,seq,take_amount);
    remaining:=remaining-take_amount;
    exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'developer_credit_insufficient';end if;
  return jsonb_build_object('decision','admitted','holdId',r.id,'state',r.state);
end $$;

create function public.developer_dispatch_lots_v2(p_hold uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  update public.developer_credit_holds_v2 set state='dispatched' where id=p_hold and state='reserved';
  return found;
end $$;

create function public.developer_finish_lots_v2(p_hold uuid,p_outcome text,p_amount numeric,p_at timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.developer_credit_holds_v2%rowtype; l record; charged numeric; remaining numeric; unused numeric; returnable boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into r from public.developer_credit_holds_v2 where id=p_hold for update;
  if not found then return false;end if;
  if p_at is null or not isfinite(p_at) then raise exception 'developer_credit_date_invalid';end if;
  if r.state in ('settled','released') then return r.state=p_outcome and r.final_amount=p_amount;end if;
  if p_outcome='uncertain' then
    if r.state not in ('dispatched','uncertain') then return false;end if;
    update public.developer_credit_holds_v2 set state='uncertain' where id=r.id;
    return true;
  elsif p_outcome='released' then
    if r.state<>'reserved' or p_amount is distinct from 0::numeric then return false;end if;
  elsif p_outcome='settled' then
    if r.state not in ('dispatched','uncertain') or p_amount is null or p_amount<0
      or p_amount>r.reserved_amount or p_amount<>round(p_amount,8) then return false;end if;
  else return false;end if;
  remaining:=p_amount;
  for l in select h.lot_id,h.reserved_amount,lot.kind,lot.issued_at,lot.expires_at,lot.owner_id
    from public.developer_credit_hold_lots_v2 h join public.developer_credit_lots_v2 lot on lot.id=h.lot_id
    where h.hold_id=r.id order by h.sequence for update of h,lot loop
    charged:=least(l.reserved_amount,remaining);unused:=l.reserved_amount-charged;
    returnable:=l.expires_at>p_at and (l.kind='purchased' or exists(
      select 1 from public.developer_pro_period_v2(l.owner_id,p_at) p where p.period_start=l.issued_at));
    update public.developer_credit_lots_v2 set held_amount=held_amount-l.reserved_amount,
      spent_amount=spent_amount+charged,
      available_amount=available_amount+case when returnable then unused else 0 end,
      expired_amount=expired_amount+case when returnable then 0 else unused end where id=l.lot_id;
    update public.developer_credit_hold_lots_v2 set charged_amount=charged where hold_id=r.id and lot_id=l.lot_id;
    remaining:=remaining-charged;
  end loop;
  if remaining<>0 then raise exception 'developer_credit_settlement_invariant';end if;
  -- Apply outstanding reversal targets to newly released value before it can
  -- be reused. Held charges remain recorded; any shortfall remains a liability.
  for l in select lot.id,lot.available_amount,lot.expired_amount,lot.reversed_amount,x.target_amount
    from public.developer_credit_hold_lots_v2 h
    join public.developer_credit_lots_v2 lot on lot.id=h.lot_id
    join public.developer_credit_reversals_v2 x on x.lot_id=lot.id
    where h.hold_id=r.id and x.unresolved_amount>0 for update of lot,x loop
    charged:=least(l.available_amount,greatest(0,l.target_amount-l.reversed_amount));
    unused:=least(l.expired_amount,greatest(0,l.target_amount-l.reversed_amount-charged));
    update public.developer_credit_lots_v2 set available_amount=available_amount-charged,
      expired_amount=expired_amount-unused,reversed_amount=reversed_amount+charged+unused where id=l.id;
    update public.developer_credit_reversals_v2 set unresolved_amount=greatest(0,l.target_amount-l.reversed_amount-charged-unused),
      updated_at=clock_timestamp() where lot_id=l.id;
  end loop;
  update public.developer_credit_holds_v2 set state=p_outcome,final_amount=p_amount,finished_at=p_at where id=r.id;
  return true;
end $$;

revoke all on function public.developer_credit_expire_v2(uuid,timestamptz),
 public.developer_pro_period_v2(uuid,timestamptz),public.developer_refresh_pro_v2(uuid,timestamptz),
 public.developer_record_purchase_v2(uuid,text,timestamptz),
 public.developer_reserve_lots_v2(uuid,uuid,text,text,numeric,timestamptz),
 public.developer_dispatch_lots_v2(uuid),public.developer_finish_lots_v2(uuid,text,numeric,timestamptz)
 from public,anon,authenticated;
grant execute on function public.developer_credit_expire_v2(uuid,timestamptz),
 public.developer_pro_period_v2(uuid,timestamptz),public.developer_refresh_pro_v2(uuid,timestamptz),
 public.developer_record_purchase_v2(uuid,text,timestamptz),
 public.developer_reserve_lots_v2(uuid,uuid,text,text,numeric,timestamptz),
 public.developer_dispatch_lots_v2(uuid),public.developer_finish_lots_v2(uuid,text,numeric,timestamptz)
 to service_role;
