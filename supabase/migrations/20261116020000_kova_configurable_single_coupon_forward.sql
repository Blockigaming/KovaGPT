-- Optional coupon selection remains bound to the durable one-session claim.
-- This permits an owner-configured discount or no discount without weakening
-- account ownership, price authority, or the one-pending-checkout invariant.
begin;

do $$
begin
  if to_regprocedure('public.kova_policy_claim_checkout(uuid,text,text,text,text)') is null then
    raise exception 'billing_policy_claim_checkout_missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.kova_policy_checkout_claims'::regclass
      and conname='kova_policy_checkout_claims_check'
      and pg_get_constraintdef(oid) like '%intro_eligible%'
  ) then
    raise exception 'billing_policy_checkout_claim_schema_unqualified';
  end if;
end;
$$;

create or replace function public.kova_policy_claim_checkout(p_user uuid,p_environment text,p_price text,p_coupon text,p_return_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype; customer text; eligible boolean;
begin
  if p_environment is null or p_environment not in ('live','sandbox')
     or p_price is null or p_price !~ '^price_[A-Za-z0-9_]+$'
     or (p_coupon is not null and p_coupon !~ '^[A-Za-z0-9_-]{1,200}$')
     or p_return_url is null or p_return_url not in (
       'https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}',
       'https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io/checkout/return?session_id={CHECKOUT_SESSION_ID}') then
    raise exception 'billing_policy_checkout_input_invalid';
  end if;
  perform kova_private.kova_policy_lock_account(p_user);
  if not exists(select 1 from public.billing_plan_tiers where environment=p_environment and stripe_price_id=p_price)
     or (p_environment='live' and p_price not in ('price_1UAzhHAEZlsb6DBYWw2oUCeO','price_1UEw6FAEZlsb6DBYuksCKOBR')) then
    raise exception 'billing_policy_price_unqualified';
  end if;
  select stripe_customer_id into customer from public.kova_policy_customer_bindings
    where user_id=p_user and environment=p_environment and retired_at is null for update;
  if customer is null then raise exception 'billing_policy_customer_mapping_required'; end if;
  select * into c from public.kova_policy_checkout_claims
    where user_id=p_user and state in ('pending','open') for update;
  if found then
    if c.environment<>p_environment or c.customer_id<>customer or c.price_id<>p_price
       or c.return_url<>p_return_url or c.coupon_id is distinct from p_coupon then
      raise exception 'billing_policy_checkout_reconciliation_pending';
    end if;
    return kova_private.kova_policy_checkout_json(c);
  end if;
  if exists(select 1 from public.subscriptions where user_id=p_user and environment=p_environment
      and status<>'incomplete_expired' and (current_period_end is null or current_period_end>clock_timestamp())) then
    raise exception 'billing_policy_active_subscription_exists';
  end if;
  eligible:=p_coupon is not null and not exists(
    select 1 from public.kova_policy_intro_redemptions where user_id=p_user
  );
  insert into public.kova_policy_checkout_claims(user_id,environment,customer_id,price_id,coupon_id,
    intro_eligible,return_url,expires_at)
    values(p_user,p_environment,customer,p_price,case when eligible then p_coupon else null end,
      eligible,p_return_url,date_trunc('second',clock_timestamp())+interval '45 minutes') returning * into c;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;

revoke all on function public.kova_policy_claim_checkout(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.kova_policy_claim_checkout(uuid,text,text,text,text) to service_role;

commit;
