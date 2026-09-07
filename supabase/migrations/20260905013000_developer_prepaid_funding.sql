-- No offers, funds, Stripe calls or paid activation are seeded by this migration.
create table public.developer_credit_offers (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
  environment text not null check(environment in ('sandbox','live')),
  stripe_price_id text not null check(stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  subtotal_amount bigint not null check(subtotal_amount between 1 and 100000000),
  credits_amount bigint not null check(credits_amount>0 and credits_amount<=subtotal_amount),
  refund_reserve bigint not null check(refund_reserve>=0 and refund_reserve<=subtotal_amount),
  dispute_reserve bigint not null check(dispute_reserve>=0 and dispute_reserve<=subtotal_amount),
  maximum_processor_fee bigint not null check(maximum_processor_fee>=0 and maximum_processor_fee<=subtotal_amount),
  tax_mode text not null check(tax_mode in ('automatic','reviewed_exempt')),
  tax_review_reference text not null check(length(tax_review_reference) between 1 and 500),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz not null,
  expires_at timestamptz not null, active boolean not null default false, created_at timestamptz not null default now(),
  check(expires_at>approved_at)
);
create function public.guard_developer_credit_offer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-'active'-'approved_by') is distinct from (to_jsonb(old)-'active'-'approved_by')
    or (new.approved_by is distinct from old.approved_by and new.approved_by is not null) then
    raise exception 'developer_offer_immutable';
  end if;
  if new.active and not old.active then raise exception 'developer_offer_reactivation_forbidden';end if;
  return new;
end $$;
create trigger developer_credit_offer_immutable before update or delete on public.developer_credit_offers for each row execute function public.guard_developer_credit_offer();

alter table public.developer_credit_accounts add column funding_debt numeric(20,8) not null default 0 check(funding_debt>=0);
alter table public.developer_credit_accounts add column funding_collection_rate numeric(20,8) check(funding_collection_rate>=0);
alter table public.credit_purchases alter column processor_percentage_fee drop not null,alter column processor_fixed_fee drop not null;
alter table public.credit_purchases add column processor_total_fee numeric(20,8),add column processor_environment text;

create table public.developer_funding_attempts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.developer_credit_accounts(id),
  owner_id uuid references auth.users(id) on delete set null, request_key text not null check(length(request_key) between 1 and 128),
  offer_id uuid not null references public.developer_credit_offers(id), offer_snapshot jsonb not null,
  state text not null default 'creating' check(state in ('creating','open','paid','expired','reconciliation_required')),
  checkout_session_id text unique, checkout_url text, checkout_expires_at timestamptz not null default now()+interval '1 hour',
  checkout_create_started_at timestamptz,checkout_create_parameters jsonb,
  checkout_discovery_cursor text,checkout_discovery_found_id text,
  revision bigint not null default 1, checked_revision bigint not null default 0,
  lease_token uuid,lease_expires_at timestamptz,lease_revision bigint,last_checked_at timestamptz,
  retry_after timestamptz,
  last_error_code text check(last_error_code ~ '^[a-z_]{3,80}$'),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(account_id,request_key)
);
create index developer_funding_pending_idx on public.developer_funding_attempts(last_checked_at nulls first,id);
create index developer_funding_account_history_idx on public.developer_funding_attempts(account_id,created_at desc,id);
create table public.developer_funding_receipts (
  attempt_id uuid primary key references public.developer_funding_attempts(id),
  purchase_id uuid not null unique references public.credit_purchases(id),charge_id text not null unique,
  immutable_evidence jsonb not null,refunded_amount bigint not null default 0,
  reversal_amount numeric(20,8) not null default 0,latest_evidence jsonb not null,updated_at timestamptz not null default now()
);
create table public.developer_funding_events (
  environment text not null,event_id text not null,attempt_id uuid not null references public.developer_funding_attempts(id),
  created_at timestamptz not null default now(),primary key(environment,event_id)
);
alter table public.developer_credit_offers enable row level security;
alter table public.developer_funding_attempts enable row level security;
alter table public.developer_funding_receipts enable row level security;
alter table public.developer_funding_events enable row level security;
revoke all on public.developer_credit_offers,public.developer_funding_attempts,public.developer_funding_receipts,public.developer_funding_events from public,anon,authenticated;
grant all on public.developer_credit_offers,public.developer_funding_attempts,public.developer_funding_receipts,public.developer_funding_events to service_role;

create function public.begin_developer_funding(p_owner uuid,p_account uuid,p_offer uuid,p_request_key text,p_environment text)
returns public.developer_funding_attempts language plpgsql security invoker set search_path='' as $$
declare offer public.developer_credit_offers%rowtype; a public.developer_credit_accounts%rowtype; item public.developer_funding_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or not exists(select 1 from public.developer_account_owners where account_id=p_account and owner_id=p_owner) then raise exception 'developer_owner_unavailable';end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if p_request_key is null or p_request_key !~ '^[!-~]{1,128}$' then raise exception 'developer_request_key_invalid';end if;
  select * into item from public.developer_funding_attempts where account_id=p_account and request_key=p_request_key for update;
  if found then
    if item.offer_id<>p_offer or item.offer_snapshot->>'environment'<>p_environment then raise exception 'developer_funding_idempotency_conflict';end if;
    return item;
  end if;
  select * into a from public.developer_credit_accounts where id=p_account for update;
  select * into offer from public.developer_credit_offers where id=p_offer and active and approved_by is not null and approved_at<=now() and expires_at>now() and environment=p_environment;
  if not found or offer.currency<>a.currency or (a.suspended_at is not null and a.suspension_reason is distinct from 'funding_reversal') then raise exception 'developer_funding_unavailable';end if;
  if (select count(*) from public.developer_funding_attempts where account_id=p_account and state in ('creating','open','reconciliation_required'))>=3 then raise exception 'developer_funding_pending';end if;
  insert into public.developer_funding_attempts(account_id,owner_id,request_key,offer_id,offer_snapshot)
    values(p_account,p_owner,p_request_key,p_offer,to_jsonb(offer)) returning * into item;
  return item;
end $$;

create function public.queue_developer_funding(p_attempt uuid,p_environment text,p_event text,p_session text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.developer_funding_attempts where id=p_attempt and offer_snapshot->>'environment'=p_environment) then return false;end if;
  if p_session is not null then
    if p_session !~ '^cs_[A-Za-z0-9_]+$' then return false;end if;
    update public.developer_funding_attempts set checkout_session_id=p_session,retry_after=null where id=p_attempt and (checkout_session_id is null or checkout_session_id=p_session);
    if not found then raise exception 'developer_funding_session_conflict';end if;
  end if;
  insert into public.developer_funding_events(environment,event_id,attempt_id) values(p_environment,p_event,p_attempt) on conflict do nothing;
  if found then update public.developer_funding_attempts set revision=revision+1,updated_at=now() where id=p_attempt;end if;
  return true;
end $$;

create function public.claim_developer_funding(p_attempt uuid default null)
returns setof public.developer_funding_attempts language plpgsql security invoker set search_path='' as $$
declare item public.developer_funding_attempts%rowtype;
begin
  update public.developer_funding_attempts set state='expired',checked_revision=revision,last_checked_at=now(),retry_after=null
    where (p_attempt is null or id=p_attempt) and state='creating' and checkout_create_started_at is null and checkout_session_id is null
      and checkout_expires_at<=now()+interval '30 minutes' and (lease_expires_at is null or lease_expires_at<now());
  select * into item from public.developer_funding_attempts
    where (p_attempt is null or id=p_attempt) and (lease_expires_at is null or lease_expires_at<now()) and (retry_after is null or retry_after<=now())
      and (revision>checked_revision or (state in ('creating','open','reconciliation_required') and (last_checked_at is null or last_checked_at<now()-interval '5 minutes'))
        or (state='paid' and last_checked_at<now()-interval '15 minutes'))
    order by coalesce(last_checked_at,created_at),id limit 1 for update skip locked;
  if not found then return;end if;
  update public.developer_funding_attempts set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',lease_revision=revision where id=item.id returning * into item;
  return next item;
end $$;

create function public.start_developer_checkout(p_attempt uuid,p_lease uuid,p_parameters jsonb)
returns public.developer_funding_attempts language plpgsql security invoker set search_path='' as $$
declare item public.developer_funding_attempts%rowtype; v_owner uuid;
begin
  select owner_id into v_owner from public.developer_funding_attempts where id=p_attempt;
  if v_owner is null then raise exception 'developer_owner_unavailable';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into item from public.developer_funding_attempts where id=p_attempt and lease_token=p_lease and lease_expires_at>now() for update;
  if not found then raise exception 'developer_funding_lease_changed';end if;
  if item.checkout_create_started_at is not null then return item;end if;
  if item.state<>'creating' or item.checkout_expires_at<now()+interval '30 minutes'
    or not kova_private.auth_user_exists(v_owner) or exists(select 1 from public.account_deletion_fences where user_id=v_owner)
    or not exists(select 1 from public.developer_account_owners where account_id=item.account_id and owner_id=v_owner)
    or not exists(select 1 from public.developer_credit_offers where id=item.offer_id and active and approved_by is not null and expires_at>now())
    or p_parameters is null or jsonb_typeof(p_parameters)<>'object' or pg_column_size(p_parameters)>8192
    or p_parameters->>'client_reference_id' is distinct from item.id::text
    or p_parameters->'line_items' is distinct from jsonb_build_array(jsonb_build_object('price',item.offer_snapshot->>'stripe_price_id','quantity',1))
    or p_parameters->>'mode' is distinct from 'payment'
    or p_parameters->>'expires_at' is distinct from floor(extract(epoch from item.checkout_expires_at))::bigint::text
    or p_parameters->'metadata' is distinct from jsonb_build_object('developer_funding_attempt',item.id::text,'developer_account',item.account_id::text,'integration_identifier','kovadevcreditabcdefgh')
    or p_parameters->'payment_intent_data'->'metadata' is distinct from p_parameters->'metadata'
    or p_parameters->'automatic_tax' is distinct from jsonb_build_object('enabled',item.offer_snapshot->>'tax_mode'='automatic')
    or exists(select 1 from jsonb_object_keys(p_parameters) k where k not in ('mode','line_items','client_reference_id','metadata','payment_intent_data','expires_at','automatic_tax','success_url','cancel_url')) then raise exception 'developer_checkout_unavailable';end if;
  update public.developer_funding_attempts set checkout_create_started_at=now(),checkout_create_parameters=p_parameters where id=item.id returning * into item;
  return item;
end $$;

-- After the idempotency window, only scan the closed creation interval. A durable
-- cursor makes large merchant histories bounded and does not replay a create.
create function public.record_developer_checkout_discovery(p_attempt uuid,p_lease uuid,p_cursor text,p_found text,p_complete boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare item public.developer_funding_attempts%rowtype; found_id text;
begin
  select * into item from public.developer_funding_attempts where id=p_attempt and lease_token=p_lease and lease_expires_at>now() for update;
  if not found or item.checkout_create_started_at is null or item.checkout_create_started_at>now()-interval '23 hours' then return false;end if;
  if (p_cursor is not null and p_cursor !~ '^cs_[A-Za-z0-9_]+$') or (p_found is not null and p_found !~ '^cs_[A-Za-z0-9_]+$')
    or p_complete is null or (not p_complete and p_cursor is null) then raise exception 'developer_discovery_invalid';end if;
  if item.checkout_discovery_found_id is not null and p_found is not null and item.checkout_discovery_found_id<>p_found then raise exception 'developer_processor_session_ambiguous';end if;
  if item.checkout_session_id is not null and p_found is not null and item.checkout_session_id<>p_found then raise exception 'developer_processor_session_ambiguous';end if;
  found_id:=coalesce(item.checkout_session_id,item.checkout_discovery_found_id,p_found);
  update public.developer_funding_attempts set checkout_discovery_cursor=p_cursor,checkout_discovery_found_id=coalesce(checkout_discovery_found_id,p_found),
    checkout_session_id=case when p_complete then found_id else checkout_session_id end,
    state=case when p_complete and found_id is null then 'expired' else state end,
    checked_revision=case when p_complete and found_id is null then revision else checked_revision end,
    revision=case when p_complete and found_id is null then revision else revision+1 end,
    lease_token=null,lease_expires_at=null,retry_after=case when p_complete then null else now()+interval '1 second' end,last_checked_at=now() where id=item.id;
  return true;
end $$;
revoke all on function public.start_developer_checkout(uuid,uuid,jsonb),public.record_developer_checkout_discovery(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.start_developer_checkout(uuid,uuid,jsonb),public.record_developer_checkout_discovery(uuid,uuid,text,text,boolean) to service_role;

create function public.complete_developer_funding(p_attempt uuid,p_lease uuid,p_revision bigint,p_session jsonb,p_receipt jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare item public.developer_funding_attempts%rowtype; a public.developer_credit_accounts%rowtype; prior public.developer_funding_receipts%rowtype;
  immutable jsonb; purchase uuid; credits numeric; target numeric; delta numeric; available numeric; debt numeric; applied numeric; refunded bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into item from public.developer_funding_attempts where id=p_attempt and lease_token=p_lease and lease_expires_at>now() for update;
  if not found or p_revision is distinct from item.lease_revision or p_session is null or p_session->>'id' is null then return false;end if;
  if item.checkout_session_id is not null and item.checkout_session_id<>p_session->>'id' then raise exception 'developer_funding_session_conflict';end if;
  if p_session->>'state' not in ('open','paid','expired','reconciliation_required') then raise exception 'developer_funding_state_invalid';end if;
  if item.state='paid' and p_session->>'state'<>'paid' then return false;end if;
  if p_receipt is not null then
    if jsonb_typeof(p_receipt)<>'object' or pg_column_size(p_receipt)>16384
      or exists(select 1 from unnest(array['sessionId','paymentIntentId','chargeId','balanceTransactionId','environment','currency']) as k
        where p_receipt->>k is null or length(p_receipt->>k) not between 1 and 200)
      or exists(select 1 from unnest(array['subtotal','gross','tax','fee','net','refundedGross','reversedGross']) as k
        where jsonb_typeof(p_receipt->k) is distinct from 'number' or (p_receipt->>k)::numeric<0 or (p_receipt->>k)::numeric>1000000000 or (p_receipt->>k)::numeric<>trunc((p_receipt->>k)::numeric))
      or jsonb_typeof(p_receipt->'additionalFees') is distinct from 'number' or abs((p_receipt->>'additionalFees')::numeric)>1000000000
      or (p_receipt->>'refundedGross')::numeric>(p_receipt->>'reversedGross')::numeric then raise exception 'developer_funding_receipt_invalid';end if;
    if p_session->>'state'<>'paid' or p_receipt->>'sessionId'<>p_session->>'id'
      or p_receipt->>'environment'<>item.offer_snapshot->>'environment' or p_receipt->>'currency'<>item.offer_snapshot->>'currency'
      or (p_receipt->>'subtotal')::numeric<>(item.offer_snapshot->>'subtotal_amount')::numeric
      or (p_receipt->>'gross')::numeric<=0 or (p_receipt->>'gross')::numeric<>(p_receipt->>'subtotal')::numeric+(p_receipt->>'tax')::numeric
      or (p_receipt->>'fee')::numeric<0 or (p_receipt->>'fee')::numeric>(p_receipt->>'gross')::numeric
      or (p_receipt->>'net')::numeric<>(p_receipt->>'gross')::numeric-(p_receipt->>'fee')::numeric
      or (p_receipt->>'reversedGross')::numeric<0 or (p_receipt->>'reversedGross')::numeric>(p_receipt->>'gross')::numeric then raise exception 'developer_funding_receipt_invalid';end if;
    immutable:=p_receipt-'refundedGross'-'reversedGross'-'disputeStatus'-'additionalFees';
    select * into prior from public.developer_funding_receipts where attempt_id=item.id for update;
    select * into a from public.developer_credit_accounts where id=item.account_id for update;
    credits:=(item.offer_snapshot->>'credits_amount')::numeric;
    available:=a.available_amount;debt:=a.funding_debt;
    if prior.attempt_id is null then
      insert into public.credit_purchases(account_id,gross_amount,tax,processor_percentage_fee,processor_fixed_fee,currency_conversion,
        net_cash_received,credits_granted,effective_collection_cost_per_credit,refund_reserve,dispute_reserve,processor_reference,processor_total_fee,processor_environment)
      values(a.id,(p_receipt->>'gross')::numeric,(p_receipt->>'tax')::numeric,null,null,0,(p_receipt->>'net')::numeric,credits,
        ((p_receipt->>'fee')::numeric+(item.offer_snapshot->>'refund_reserve')::numeric+(item.offer_snapshot->>'dispute_reserve')::numeric)/credits,
        (item.offer_snapshot->>'refund_reserve')::numeric,(item.offer_snapshot->>'dispute_reserve')::numeric,p_receipt->>'chargeId',(p_receipt->>'fee')::numeric,p_receipt->>'environment') returning id into purchase;
      applied:=least(debt,credits);debt:=debt-applied;available:=available+credits-applied;
      insert into public.developer_credit_ledger(account_id,entry_type,amount,balance_after,funding_source) values(a.id,'purchase',credits,available,item.id::text);
      insert into public.developer_funding_receipts(attempt_id,purchase_id,charge_id,immutable_evidence,latest_evidence)
        values(item.id,purchase,p_receipt->>'chargeId',immutable,p_receipt) returning * into prior;
    elsif prior.immutable_evidence is distinct from immutable then raise exception 'developer_funding_receipt_conflict';end if;
    refunded:=(p_receipt->>'refundedGross')::bigint;
    if refunded<prior.refunded_amount then raise exception 'developer_funding_receipt_stale';end if;
    target:=ceil(credits*(p_receipt->>'reversedGross')::numeric/(p_receipt->>'gross')::numeric*100000000)/100000000;
    delta:=prior.reversal_amount-target;
    if delta<0 then applied:=least(available,-delta);available:=available-applied;debt:=debt-delta-applied;
    elsif delta>0 then applied:=least(debt,delta);debt:=debt-applied;available:=available+delta-applied;end if;
    if delta<>0 then insert into public.developer_credit_ledger(account_id,entry_type,amount,balance_after,funding_source)
      values(a.id,case when delta<0 then 'refund' else 'adjustment' end,delta,available,item.id::text);end if;
    update public.credit_purchases set processor_total_fee=(p_receipt->>'fee')::numeric+(p_receipt->>'additionalFees')::numeric,
      effective_collection_cost_per_credit=((p_receipt->>'fee')::numeric+(p_receipt->>'additionalFees')::numeric+(item.offer_snapshot->>'refund_reserve')::numeric+(item.offer_snapshot->>'dispute_reserve')::numeric)/credits where id=prior.purchase_id;
    update public.developer_credit_accounts set available_amount=available,funding_debt=debt,
      funding_collection_rate=greatest(coalesce(funding_collection_rate,0),
        ceil((greatest((item.offer_snapshot->>'maximum_processor_fee')::numeric,(p_receipt->>'fee')::numeric+(p_receipt->>'additionalFees')::numeric)
          +(item.offer_snapshot->>'refund_reserve')::numeric+(item.offer_snapshot->>'dispute_reserve')::numeric)/credits*100000000)/100000000),
      suspended_at=case when debt>0 then coalesce(suspended_at,now()) when suspension_reason='funding_reversal' then null else suspended_at end,
      suspension_reason=case when debt>0 and suspended_at is null then 'funding_reversal' when debt=0 and suspension_reason='funding_reversal' then null else suspension_reason end where id=a.id;
    if (p_receipt->>'fee')::numeric+(p_receipt->>'additionalFees')::numeric>(item.offer_snapshot->>'maximum_processor_fee')::numeric then
      update public.developer_credit_offers set active=false where id=item.offer_id;
      update public.developer_credit_accounts set suspended_at=coalesce(suspended_at,now()),suspension_reason=coalesce(suspension_reason,'funding_collection_cost') where id=a.id;
    end if;
    update public.developer_funding_receipts set refunded_amount=refunded,reversal_amount=target,latest_evidence=p_receipt,updated_at=now() where attempt_id=item.id;
  elsif p_session->>'state'='paid' then raise exception 'developer_funding_receipt_required';end if;
  update public.developer_funding_attempts set checkout_session_id=p_session->>'id',checkout_url=case when p_session->>'state'='open' then p_session->>'url' else null end,
    state=p_session->>'state',checked_revision=p_revision,last_checked_at=now(),retry_after=null,last_error_code=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=item.id;
  return true;
end $$;

create function public.defer_developer_funding(p_attempt uuid,p_lease uuid,p_error text default 'provider_proof_unavailable')
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.developer_funding_attempts set lease_token=null,lease_expires_at=null,retry_after=now()+interval '5 minutes',last_checked_at=now(),
    last_error_code=case when p_error ~ '^[a-z_]{3,80}$' then p_error else 'provider_proof_unavailable' end,
    state=case when state='paid' or (checkout_session_id is null and created_at<now()-interval '23 hours') then 'reconciliation_required' else state end
    where id=p_attempt and lease_token=p_lease;
  return found;
end $$;
revoke all on function public.defer_developer_funding(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.defer_developer_funding(uuid,uuid,text) to service_role;

-- Reject before any Storage/Auth deletion when a payment can still complete.
create function public.guard_developer_funding_account_deletion() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if exists(select 1 from public.developer_funding_attempts where owner_id=new.user_id and state in ('creating','open','reconciliation_required')) then
    raise exception 'developer_payment_reconciliation_pending';
  end if;
  return new;
end $$;
create trigger developer_funding_deletion_barrier before insert or update on public.account_deletion_fences for each row execute function public.guard_developer_funding_account_deletion();

revoke all on function public.begin_developer_funding(uuid,uuid,uuid,text,text),public.queue_developer_funding(uuid,text,text,text),public.claim_developer_funding(uuid),public.complete_developer_funding(uuid,uuid,bigint,jsonb,jsonb),public.guard_developer_funding_account_deletion(),public.guard_developer_credit_offer() from public,anon,authenticated;
grant execute on function public.begin_developer_funding(uuid,uuid,uuid,text,text),public.queue_developer_funding(uuid,text,text,text),public.claim_developer_funding(uuid),public.complete_developer_funding(uuid,uuid,bigint,jsonb,jsonb),public.guard_developer_funding_account_deletion(),public.guard_developer_credit_offer() to service_role;

create function public.recover_developer_funding_debt()
returns integer language plpgsql security invoker set search_path='' as $$
declare a public.developer_credit_accounts%rowtype; applied numeric; n integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  for a in select * from public.developer_credit_accounts where funding_debt>0 and available_amount>0 order by id limit 100 for update loop
    applied:=least(a.available_amount,a.funding_debt);
    update public.developer_credit_accounts set available_amount=available_amount-applied,funding_debt=funding_debt-applied,
      suspended_at=case when funding_debt=applied and suspension_reason='funding_reversal' then null else suspended_at end,
      suspension_reason=case when funding_debt=applied and suspension_reason='funding_reversal' then null else suspension_reason end where id=a.id;
    insert into public.developer_credit_ledger(account_id,entry_type,amount,balance_after,metadata)
      values(a.id,'adjustment',0,a.available_amount-applied,jsonb_build_object('funding_debt_repaid',applied));
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.recover_developer_funding_debt() from public,anon,authenticated;
grant execute on function public.recover_developer_funding_debt() to service_role;

create view public.developer_funding_export_records with (security_invoker=true) as
  select o.owner_id,'attempt:'||a.id::text as id,'payment_attempt'::text as record_type,
    jsonb_build_object('id',a.id,'account_id',a.account_id,'state',a.state,'created_at',a.created_at,
      'offer',jsonb_build_object('id',a.offer_id,'name',a.offer_snapshot->>'name','currency',a.offer_snapshot->>'currency',
        'subtotal_amount',a.offer_snapshot->'subtotal_amount','credits_amount',a.offer_snapshot->'credits_amount')) as data
    from public.developer_account_owners o join public.developer_funding_attempts a on a.account_id=o.account_id
  union all select o.owner_id,'reversal:'||r.attempt_id::text,'payment_reversal',
    jsonb_build_object('attempt_id',r.attempt_id,'refunded_amount',r.refunded_amount,'credit_reversal',r.reversal_amount,'updated_at',r.updated_at)
    from public.developer_account_owners o join public.developer_funding_attempts a on a.account_id=o.account_id join public.developer_funding_receipts r on r.attempt_id=a.id
  union all select o.owner_id,'debt:'||a.id::text,'funding_debt',jsonb_build_object('account_id',a.id,'amount',a.funding_debt)
    from public.developer_account_owners o join public.developer_credit_accounts a on a.id=o.account_id;
revoke all on public.developer_funding_export_records from public,anon,authenticated;
grant select on public.developer_funding_export_records to service_role;
