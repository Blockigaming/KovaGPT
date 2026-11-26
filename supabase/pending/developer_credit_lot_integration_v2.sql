
-- Integration boundary for newly provisioned or proven-empty wallets. A legacy
-- wallet with any monetary history needs a separately reviewed reconciliation,
-- not an inferred opening credit lot. The activation marker is not public.
create table public.developer_credit_api_hold_links_v2 (
  request_id uuid primary key references public.developer_api_requests(id),
  hold_id uuid unique not null references public.developer_credit_holds_v2(id)
);
alter table public.developer_credit_api_hold_links_v2 enable row level security;
revoke all on public.developer_credit_api_hold_links_v2 from public,anon,authenticated;
grant select,insert on public.developer_credit_api_hold_links_v2 to service_role;

create function public.developer_enable_credit_lots_v2(p_account uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.developer_credit_accounts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if exists(select 1 from public.developer_credit_lot_accounts_v2 where account_id=p_account) then return;end if;
  select * into a from public.developer_credit_accounts where id=p_account for update;
  if not found or a.available_amount<>0 or a.reserved_amount<>0 or a.funding_debt<>0
    or exists(select 1 from public.developer_credit_ledger where account_id=p_account)
    or exists(select 1 from public.credit_purchases where account_id=p_account)
    or exists(select 1 from public.developer_api_requests where account_id=p_account)
    then raise exception 'developer_credit_legacy_reconciliation_required';end if;
  insert into public.developer_credit_lot_accounts_v2(account_id) values(p_account);
end $$;

-- Protect marked wallets against old server revisions or any unwrapped
-- monetary update. All v2 operations use the same advisory lock and an
-- explicit transaction-local context. This is a deployment fence, not an
-- authentication mechanism; service-role credentials remain server-only.
create function public.developer_credit_lot_write_guard_v2()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.available_amount is distinct from old.available_amount
      or new.reserved_amount is distinct from old.reserved_amount
      or new.funding_debt is distinct from old.funding_debt)
    and exists(select 1 from public.developer_credit_lot_accounts_v2 where account_id=old.id)
    and current_setting('kova.developer_credit_v2',true) is distinct from old.id::text
    then raise exception 'developer_credit_v2_writer_required';end if;
  return new;
end $$;
create trigger developer_credit_lot_write_guard_v2 before update on public.developer_credit_accounts
  for each row execute function public.developer_credit_lot_write_guard_v2();

-- Reconcile the existing aggregate to exact lot totals. Legacy holds cannot
-- silently be dropped: reserved totals must already agree. The immutable old
-- ledger retains its original entries and any additional adjustment.
create function public.developer_sync_credit_lots_v2(p_account uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.developer_credit_accounts%rowtype; avail numeric; held numeric; debt numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if not exists(select 1 from public.developer_credit_lot_accounts_v2 where account_id=p_account)
    then raise exception 'developer_credit_legacy_reconciliation_required';end if;
  if p_reason not in ('pro_and_expiry','settlement','verified_purchase','consumer_hold','consumer_finish')
    then raise exception 'developer_credit_sync_invalid';end if;
  select * into a from public.developer_credit_accounts where id=p_account for update;
  select coalesce(sum(available_amount),0),coalesce(sum(held_amount),0)
    into avail,held from public.developer_credit_lots_v2 where account_id=p_account;
  select coalesce(sum(x.unresolved_amount),0) into debt from public.developer_credit_reversals_v2 x
    join public.developer_credit_lots_v2 l on l.id=x.lot_id where l.account_id=p_account;
  if a.reserved_amount<>held and p_reason not in ('consumer_hold','consumer_finish')
    then raise exception 'developer_credit_reservation_invariant';end if;
  perform set_config('kova.developer_credit_v2',p_account::text,true);
  update public.developer_credit_accounts set available_amount=avail,reserved_amount=held,funding_debt=debt,
    suspended_at=case when debt>0 then coalesce(suspended_at,clock_timestamp())
      when suspension_reason='funding_reversal' then null else suspended_at end,
    suspension_reason=case when debt>0 then coalesce(suspension_reason,'funding_reversal')
      when suspension_reason='funding_reversal' then null else suspension_reason end where id=p_account;
  if a.available_amount<>avail then
    insert into public.developer_credit_ledger(account_id,entry_type,amount,balance_after,funding_source,metadata)
      values(p_account,'adjustment',avail-a.available_amount,avail,'credit_lots_v2',jsonb_build_object('reason',p_reason));
  end if;
end $$;

-- Keep the existing approved-pricing, emergency controls, scope budgets and
-- idempotency logic. A new lot hold and original API reservation either both
-- commit or both roll back. No new provider path bypasses the old checks.
create function public.admit_developer_billing_v2(
  p_key uuid,p_request_key text,p_fingerprint text,p_provider text,p_model text,
  p_capability text,p_version uuid,p_quote jsonb,p_limits jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid; own uuid; r jsonb; hold jsonb; now_at timestamptz:=clock_timestamp(); rid uuid;
begin
  select k.account_id,o.owner_id into a,own from public.developer_billing_keys k
    join public.developer_account_owners o on o.account_id=k.account_id
    where k.id=p_key and k.enabled and k.revoked_at is null and k.expires_at>now_at;
  if a is null then raise exception 'developer_key_unavailable';end if;
  perform pg_advisory_xact_lock(hashtextextended(own::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  perform public.developer_enable_credit_lots_v2(a);
  perform public.developer_credit_expire_v2(a,now_at);
  perform public.developer_refresh_pro_v2(own,now_at);
  perform public.developer_sync_credit_lots_v2(a,'pro_and_expiry');
  perform set_config('kova.developer_credit_v2',a::text,true);
  r:=public.admit_developer_billing(p_key,p_request_key,p_fingerprint,p_provider,p_model,p_capability,p_version,p_quote,p_limits);
  rid:=(r->>'request_id')::uuid;
  if r->>'decision'='admitted' then
    hold:=public.developer_reserve_lots_v2(own,a,'api:'||rid::text,'api',(p_quote->>'maximumReservedCharge')::numeric,now_at);
    if hold->>'decision'<>'admitted' then raise exception 'developer_credit_reservation_invariant';end if;
    insert into public.developer_credit_api_hold_links_v2(request_id,hold_id) values(rid,(hold->>'holdId')::uuid);
    perform public.developer_sync_credit_lots_v2(a,'settlement');
  elsif not exists(select 1 from public.developer_credit_api_hold_links_v2 where request_id=rid) then
    raise exception 'developer_credit_legacy_reconciliation_required';
  end if;
  return r;
end $$;

create function public.dispatch_developer_billing_v2(p_request uuid,p_lease uuid,p_files jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare own uuid; hold uuid; ok boolean;
begin
  select o.owner_id,l.hold_id into own,hold from public.developer_api_requests r
    join public.developer_account_owners o on o.account_id=r.account_id
    join public.developer_credit_api_hold_links_v2 l on l.request_id=r.id
    where r.id=p_request and r.lease_token=p_lease;
  if hold is null then return false;end if;
  perform pg_advisory_xact_lock(hashtextextended(own::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if p_files is null then ok:=public.dispatch_developer_billing(p_request,p_lease);
  else ok:=public.dispatch_developer_billing_with_files(p_request,p_lease,p_files);end if;
  if not ok then return false;end if;
  if not public.developer_dispatch_lots_v2(hold) then raise exception 'developer_credit_dispatch_invariant';end if;
  return true;
end $$;

create function public.finish_developer_billing_v2(p_request uuid,p_lease uuid,p_outcome text,p_result jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a uuid; hold uuid; amount numeric; ok boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select r.account_id,l.hold_id into a,hold from public.developer_api_requests r
    left join public.developer_credit_api_hold_links_v2 l on l.request_id=r.id
    where r.id=p_request and r.lease_token=p_lease;
  if a is null then return false;end if;
  if hold is null then
    if exists(select 1 from public.developer_credit_lot_accounts_v2 where account_id=a)
      then raise exception 'developer_credit_reservation_invariant';end if;
    return public.finish_developer_billing(p_request,p_lease,p_outcome,p_result);
  end if;
  perform set_config('kova.developer_credit_v2',a::text,true);
  ok:=public.finish_developer_billing(p_request,p_lease,p_outcome,p_result);
  if not ok then return false;end if;
  amount:=case when p_outcome='released' then 0 when p_outcome='settled' then round((p_result->>'finalCustomerCharge')::numeric,8) else null end;
  if not public.developer_finish_lots_v2(hold,p_outcome,amount,clock_timestamp())
    then raise exception 'developer_credit_settlement_invariant';end if;
  perform public.developer_sync_credit_lots_v2(a,'settlement');
  return true;
end $$;

create function public.recover_developer_billing_v2(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare r record; handled integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  for r in select id,lease_token,settlement_state from public.developer_api_requests
    where settlement_state in ('reserved','dispatched') and lease_expires_at<now()
    order by lease_expires_at,id limit greatest(1,least(coalesce(p_limit,100),100)) for update loop
    if r.settlement_state='reserved' then
      if not public.finish_developer_billing_v2(r.id,r.lease_token,'released','{}')
        then raise exception 'developer_credit_settlement_invariant';end if;
    else
      update public.developer_api_requests set settlement_state='reconciliation_required' where id=r.id;
      insert into public.developer_billing_alerts(request_id,reason) values(r.id,'authoritative_usage_required') on conflict do nothing;
    end if;
    handled:=handled+1;
  end loop;
  return handled;
end $$;

create function public.complete_developer_funding_v2(
  p_attempt uuid,p_lease uuid,p_revision bigint,p_session jsonb,p_receipt jsonb,p_paid_at timestamptz
) returns boolean language plpgsql security invoker set search_path='' as $$
declare a uuid; ok boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select account_id into a from public.developer_funding_attempts where id=p_attempt and lease_token=p_lease;
  if a is null then return false;end if;
  if p_receipt is null then
    return public.complete_developer_funding(p_attempt,p_lease,p_revision,p_session,p_receipt);
  end if;
  if p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>clock_timestamp()
    then raise exception 'developer_credit_purchase_time_unverified';end if;
  perform public.developer_enable_credit_lots_v2(a);
  perform set_config('kova.developer_credit_v2',a::text,true);
  ok:=public.complete_developer_funding(p_attempt,p_lease,p_revision,p_session,p_receipt);
  if not ok then return false;end if;
  perform public.developer_record_purchase_v2(p_attempt,p_receipt->>'chargeId',p_paid_at);
  perform public.developer_sync_credit_lots_v2(a,'verified_purchase');
  return true;
end $$;

revoke all on function public.developer_enable_credit_lots_v2(uuid),
 public.developer_credit_lot_write_guard_v2(),public.developer_sync_credit_lots_v2(uuid,text),
 public.admit_developer_billing_v2(uuid,text,text,text,text,text,uuid,jsonb,jsonb),
 public.dispatch_developer_billing_v2(uuid,uuid,jsonb),public.finish_developer_billing_v2(uuid,uuid,text,jsonb),
 public.recover_developer_billing_v2(integer),public.complete_developer_funding_v2(uuid,uuid,bigint,jsonb,jsonb,timestamptz)
 from public,anon,authenticated;
grant execute on function public.developer_enable_credit_lots_v2(uuid),
 public.developer_credit_lot_write_guard_v2(),public.developer_sync_credit_lots_v2(uuid,text),
 public.admit_developer_billing_v2(uuid,text,text,text,text,text,uuid,jsonb,jsonb),
 public.dispatch_developer_billing_v2(uuid,uuid,jsonb),public.finish_developer_billing_v2(uuid,uuid,text,jsonb),
 public.recover_developer_billing_v2(integer),public.complete_developer_funding_v2(uuid,uuid,bigint,jsonb,jsonb,timestamptz)
 to service_role;

-- Owner-scoped customer billing projection. No grant or balance mutation on GET.
-- Expired or ineligible included amounts are not displayed as spendable.
create function public.developer_credit_wallet_status_v2(p_owner uuid,p_account uuid,p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.developer_credit_accounts%rowtype; at_time timestamptz:=clock_timestamp();
  included numeric; purchased numeric; held numeric; expired numeric; period record;
  items jsonb; more boolean;
begin
  if p_offset is null or p_offset not between 0 and 100000 then raise exception 'developer_page_invalid';end if;
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or not exists(select 1 from public.developer_account_owners where account_id=p_account and owner_id=p_owner)
    then raise exception 'developer_owner_required' using errcode='42501';end if;
  select * into a from public.developer_credit_accounts where id=p_account;
  if not found then raise exception 'developer_owner_required' using errcode='42501';end if;
  if not exists(select 1 from public.developer_credit_lot_accounts_v2 where account_id=p_account)
    then return jsonb_build_object('tracked',false,'currency',a.currency,'asOf',at_time);end if;
  select * into period from public.developer_pro_period_v2(p_owner,at_time);
  select
    coalesce(sum(available_amount) filter(where kind='included_pro' and issued_at=period.period_start and expires_at>at_time),0),
    coalesce(sum(available_amount) filter(where kind='purchased' and expires_at>at_time),0),
    coalesce(sum(held_amount),0),
    coalesce(sum(expired_amount+case when expires_at<=at_time then available_amount else 0 end),0)
    into included,purchased,held,expired
    from public.developer_credit_lots_v2 where account_id=p_account and owner_id=p_owner;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.issued_at desc,q.id desc),'[]'::jsonb) into items
    from (select id,kind,issued_at,expires_at,issued_amount,held_amount,spent_amount,expired_amount,reversed_amount,
      case when expires_at<=at_time or (kind='included_pro' and issued_at is distinct from period.period_start)
        then 0 else available_amount end as available_amount
      from public.developer_credit_lots_v2 where account_id=p_account and owner_id=p_owner
      order by issued_at desc,id desc offset p_offset limit 25) q;
  select exists(select 1 from public.developer_credit_lots_v2
    where account_id=p_account and owner_id=p_owner offset p_offset+25 limit 1) into more;
  return jsonb_build_object('tracked',true,'currency',a.currency,'asOf',at_time,
    'included',included,'purchased',purchased,'held',held,'expired',expired,'debt',a.funding_debt,
    'suspended',a.suspended_at is not null,'renewalAt',period.period_end,'lots',items,'hasMore',more);
end $$;
revoke all on function public.developer_credit_wallet_status_v2(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.developer_credit_wallet_status_v2(uuid,uuid,integer) to service_role;
