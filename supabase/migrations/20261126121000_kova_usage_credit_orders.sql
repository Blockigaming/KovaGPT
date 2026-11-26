create table kova_private.usage_credit_orders (
  id uuid primary key,
  buyer uuid not null,
  environment text not null check (environment in ('sandbox','live')),
  amount_cents integer not null check (amount_cents between 500 and 50000),
  gift boolean not null,
  gift_code uuid not null unique default gen_random_uuid(),
  stripe_session text unique,
  payment_intent text unique,
  funded_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  refunded_cents integer not null default 0 check (refunded_cents between 0 and amount_cents),
  disputed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on kova_private.usage_credit_orders (buyer, created_at desc);
create index on kova_private.usage_credit_orders (claimed_by, claimed_at desc);
alter table kova_private.usage_credit_orders enable row level security;
revoke all on kova_private.usage_credit_orders from public,anon,authenticated,service_role;

create or replace function public.kova_prepare_credit_order(
  p_id uuid,p_buyer uuid,p_env text,p_amount integer,p_gift boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from account_deletion_fences where user_id=p_buyer) then return false; end if;
  insert into kova_private.usage_credit_orders(id,buyer,environment,amount_cents,gift)
    values(p_id,p_buyer,p_env,p_amount,p_gift) on conflict do nothing;
  return exists(select 1 from kova_private.usage_credit_orders where id=p_id and buyer=p_buyer
    and environment=p_env and amount_cents=p_amount and gift=p_gift);
end $$;

create or replace function public.kova_fund_credit_order(
  p_id uuid,p_env text,p_session text,p_intent text,p_amount integer,p_refund integer,p_disputed boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update kova_private.usage_credit_orders set stripe_session=p_session,payment_intent=p_intent,
    funded_at=coalesce(funded_at,now()), refunded_cents=greatest(refunded_cents,p_refund),
    disputed=disputed or p_disputed,
    claimed_by=case when gift then claimed_by else buyer end,
    claimed_at=case when gift then claimed_at else coalesce(claimed_at,now()) end
    where id=p_id and environment=p_env and amount_cents=p_amount
      and (stripe_session is null or stripe_session=p_session)
      and (payment_intent is null or payment_intent=p_intent);
  return found;
end $$;

create or replace function public.kova_revoke_credit_payment(
  p_env text,p_intent text,p_refund integer,p_disputed boolean
) returns void language sql security definer set search_path=public,pg_temp as $$
  update kova_private.usage_credit_orders
    set refunded_cents=greatest(refunded_cents,least(amount_cents,p_refund)),disputed=disputed or p_disputed
    where environment=p_env and payment_intent=p_intent;
$$;

create or replace function public.kova_claim_credit_gift(p_id uuid,p_user uuid,p_env text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from account_deletion_fences where user_id=p_user) then return false; end if;
  update kova_private.usage_credit_orders set claimed_by=p_user,claimed_at=now()
    where gift_code=p_id and environment=p_env and gift and funded_at is not null
      and refunded_cents<amount_cents and not disputed and claimed_by is null;
  return found or exists(select 1 from kova_private.usage_credit_orders where id=p_id
    and environment=p_env and gift and claimed_by=p_user and refunded_cents<amount_cents and not disputed);
end $$;

create or replace function public.kova_credit_wallet(p_user uuid,p_env text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'fundedCents',coalesce((select sum(amount_cents-refunded_cents)
      from kova_private.usage_credit_orders where claimed_by=p_user and environment=p_env and not disputed),0),
    'orders',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.date desc) from (
      select id,gift,case when buyer=p_user and gift and claimed_by is null and not disputed and refunded_cents<amount_cents then gift_code end as "giftCode",amount_cents as "amountCents",refunded_cents as "refundedCents",disputed,
        coalesce(claimed_at,funded_at) as date,
        (gift and buyer=p_user and claimed_by is null and not disputed and refunded_cents<amount_cents) as "shareable"
      from kova_private.usage_credit_orders where environment=p_env and funded_at is not null
        and (buyer=p_user or claimed_by=p_user)
      order by coalesce(claimed_at,funded_at) desc,id limit 50
    ) recent),'[]'::jsonb)
  );
$$;

revoke all on function public.kova_prepare_credit_order(uuid,uuid,text,integer,boolean),
  public.kova_fund_credit_order(uuid,text,text,text,integer,integer,boolean),
  public.kova_revoke_credit_payment(text,text,integer,boolean),
  public.kova_claim_credit_gift(uuid,uuid,text), public.kova_credit_wallet(uuid,text)
  from public,anon,authenticated;
grant execute on function public.kova_prepare_credit_order(uuid,uuid,text,integer,boolean),
  public.kova_fund_credit_order(uuid,text,text,text,integer,integer,boolean),
  public.kova_revoke_credit_payment(text,text,integer,boolean),
  public.kova_claim_credit_gift(uuid,uuid,text), public.kova_credit_wallet(uuid,text)
  to service_role;
