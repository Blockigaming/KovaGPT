-- Versioned, fail-closed developer API pricing and prepaid settlement.
create table public.upstream_price_registry (
  id uuid primary key default gen_random_uuid(), version integer not null,
  provider text not null, upstream_model text not null, billing_dimension text not null,
  unit text not null, unit_quantity numeric(20,8) not null check(unit_quantity>0),
  unit_price numeric(20,8) not null check(unit_price>=0), currency text not null check(length(currency)=3),
  source text not null, verification_status text not null check(verification_status in ('pending','approved','rejected','expired')),
  effective_at timestamptz not null, expires_at timestamptz, last_verified_at timestamptz,
  verifier uuid references auth.users(id) on delete set null, notes text, active boolean not null default false,
  evidence jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check(expires_at is null or expires_at>effective_at), unique(provider,upstream_model,billing_dimension,version)
);
create index upstream_price_active_idx on public.upstream_price_registry(provider,upstream_model,billing_dimension,effective_at desc) where active;

create table public.api_pricing_versions (
  id uuid primary key default gen_random_uuid(), version integer not null unique, currency text not null,
  margin_floor numeric(6,5) not null default .5 check(margin_floor>=.5 and margin_floor<1),
  risk_buffer_percentage numeric(6,5) not null default .15 check(risk_buffer_percentage>=0),
  minimum_request_charge numeric(20,8) not null, rounding_increment numeric(20,8) not null check(rounding_increment>0),
  allowance_configuration jsonb not null, public_price_configuration jsonb not null,
  status text not null check(status in ('draft','approved','retired','emergency')),
  approved_by uuid references auth.users(id), approved_at timestamptz, effective_at timestamptz not null,
  expires_at timestamptz, created_at timestamptz not null default now()
);

create table public.api_emergency_controls (
  id uuid primary key default gen_random_uuid(), scope_type text not null check(scope_type in ('global','provider','model','capability','plan','organization','project','key')),
  scope_id text not null, active boolean not null default true, reason text not null,
  safer_pricing_version_id uuid references public.api_pricing_versions(id), authorized_dynamic_floor boolean not null default false,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), released_at timestamptz
);

create table public.developer_credit_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, currency text not null,
  available_amount numeric(20,8) not null default 0 check(available_amount>=0), reserved_amount numeric(20,8) not null default 0 check(reserved_amount>=0),
  suspended_at timestamptz, suspension_reason text, unique(organization_id,currency)
);
create table public.developer_credit_ledger (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.developer_credit_accounts(id),
  request_id uuid, entry_type text not null check(entry_type in ('purchase','reserve','settle','release','refund','dispute','chargeback','promotion','adjustment')),
  amount numeric(20,8) not null, balance_after numeric(20,8) not null, funding_source text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create or replace function public.prevent_financial_entry_mutation() returns trigger language plpgsql as $$ begin raise exception 'financial_entries_are_immutable'; end $$;
create trigger developer_credit_ledger_immutable before update or delete on public.developer_credit_ledger for each row execute function public.prevent_financial_entry_mutation();

create table public.developer_api_requests (
  id uuid primary key default gen_random_uuid(), request_key text not null unique,
  account_id uuid not null references public.developer_credit_accounts(id), organization_id uuid not null,
  project_id uuid, api_key_id uuid, public_model text not null, provider text not null, upstream_model text not null,
  capability text not null, pricing_version_id uuid not null references public.api_pricing_versions(id),
  accepted_public_price jsonb not null, estimated_customer_charge numeric(20,8) not null,
  maximum_reserved_charge numeric(20,8) not null, final_customer_charge numeric(20,8),
  estimated_upstream_cost numeric(20,8) not null, final_upstream_cost numeric(20,8),
  total_variable_cost numeric(20,8), gross_profit numeric(20,8), gross_margin_percentage numeric(20,8),
  risk_buffer_amount numeric(20,8) not null, promotional_subsidy numeric(20,8) not null default 0,
  promotional_budget_id uuid, currency text not null, rounding_difference numeric(20,8) not null,
  usage_limits jsonb not null, authoritative_usage jsonb, cost_breakdown jsonb not null,
  settlement_state text not null check(settlement_state in ('reserved','dispatched','settled','uncertain','reconciliation_required','rejected')),
  below_margin_floor boolean not null default false, margin_failure_cause text,
  created_at timestamptz not null default now(), settled_at timestamptz,
  check(promotional_subsidy=0 or promotional_budget_id is not null),
  check(maximum_reserved_charge>=estimated_customer_charge)
);

create table public.credit_purchases (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.developer_credit_accounts(id),
  gross_amount numeric(20,8) not null, tax numeric(20,8) not null, processor_percentage_fee numeric(20,8) not null,
  processor_fixed_fee numeric(20,8) not null, currency_conversion numeric(20,8) not null,
  net_cash_received numeric(20,8) not null, credits_granted numeric(20,8) not null,
  effective_collection_cost_per_credit numeric(20,8) not null, refund_reserve numeric(20,8) not null,
  dispute_reserve numeric(20,8) not null, processor_reference text unique, created_at timestamptz not null default now()
);

create or replace function public.reserve_developer_api_credit(p_account uuid,p_request_key text,p_request uuid,p_amount numeric)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare remaining numeric;
begin
  if p_amount<=0 then raise exception 'invalid_reservation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account::text,0));
  if exists(
    select 1 from developer_credit_ledger
    where request_id=p_request and entry_type='reserve' and account_id=p_account
      and amount=-p_amount and metadata->>'request_key'=p_request_key
  ) then return true; end if;
  if exists(select 1 from developer_credit_ledger where request_id=p_request and entry_type='reserve') then
    raise exception 'reservation_idempotency_mismatch';
  end if;
  update developer_credit_accounts set available_amount=available_amount-p_amount,reserved_amount=reserved_amount+p_amount
   where id=p_account and suspended_at is null and available_amount>=p_amount returning available_amount into remaining;
  if not found then return false; end if;
  insert into developer_credit_ledger(account_id,request_id,entry_type,amount,balance_after,metadata)
  values(p_account,p_request,'reserve',-p_amount,remaining,jsonb_build_object('request_key',p_request_key)); return true;
end $$;

alter table public.upstream_price_registry enable row level security; alter table public.api_pricing_versions enable row level security;
alter table public.api_emergency_controls enable row level security; alter table public.developer_credit_accounts enable row level security;
alter table public.developer_credit_ledger enable row level security; alter table public.developer_api_requests enable row level security;
alter table public.credit_purchases enable row level security;
revoke all on public.upstream_price_registry,public.api_pricing_versions,public.api_emergency_controls,public.developer_credit_accounts,public.developer_credit_ledger,public.developer_api_requests,public.credit_purchases from public,anon,authenticated;
grant all on public.upstream_price_registry,public.api_pricing_versions,public.api_emergency_controls,public.developer_credit_accounts,public.developer_api_requests,public.credit_purchases to service_role;
grant select,insert on public.developer_credit_ledger to service_role;
revoke all on function public.reserve_developer_api_credit(uuid,text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.reserve_developer_api_credit(uuid,text,uuid,numeric) to service_role;

create view public.api_profitability_admin with (security_invoker=true) as
select date_trunc('day',created_at) period,public_model,upstream_model,
 count(*) requests,sum(coalesce(final_customer_charge,0)) revenue,sum(coalesce(final_upstream_cost,0)) upstream_cost,
 sum(coalesce((cost_breakdown->>'payment_processing')::numeric,0)) payment_processing_cost,
 sum(coalesce((cost_breakdown->>'infrastructure')::numeric,0)) infrastructure_allocation,
 sum(promotional_subsidy) promotional_subsidy,sum(coalesce(gross_profit,0)) gross_profit,
 case when sum(coalesce(final_customer_charge,0)+promotional_subsidy)>0 then sum(coalesce(gross_profit,0))/sum(coalesce(final_customer_charge,0)+promotional_subsidy) end gross_margin_percentage,
 count(*) filter(where below_margin_floor) requests_below_margin_floor
from public.developer_api_requests group by 1,2,3;
revoke all on public.api_profitability_admin from public,anon,authenticated; grant select on public.api_profitability_admin to service_role;
