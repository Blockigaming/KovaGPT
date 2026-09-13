begin;

-- A user-level Checkout attempt cannot prove which Stripe subscription it
-- created. Preserve exact Price IDs already attached to the same subscription,
-- but quarantine a novel legacy Pro lookup-key write as the unmapped literal
-- `pro_monthly`. This lets the legacy upsert and its completed-event ledger stay
-- consistent while exact-ID reconciliation can repair the visible row. The
-- exact-only entitlement resolver intentionally grants no paid tier meanwhile.
create or replace function public.normalize_legacy_live_subscription_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_pro_price_id text;
begin
  if new.environment = 'live' then
    if new.price_id = 'plus_monthly' then
      new.price_id := 'price_1UAzhHAEZlsb6DBYWw2oUCeO';
    elsif new.price_id = 'pro_monthly' then
      if tg_op = 'UPDATE' and old.environment = 'live' then
        select mapping.stripe_price_id
        into existing_pro_price_id
        from public.billing_plan_tiers as mapping
        where mapping.environment = 'live'
          and mapping.lookup_key = 'pro_monthly'
          and mapping.stripe_price_id = old.price_id;
      else
        -- BEFORE INSERT also runs before an ON CONFLICT update. Looking up the
        -- current row keeps a legacy upsert tied to that subscription's exact
        -- Price without inferring identity from another user-level object.
        select mapping.stripe_price_id
        into existing_pro_price_id
        from public.subscriptions as subscription
        join public.billing_plan_tiers as mapping
          on mapping.environment = subscription.environment
         and mapping.stripe_price_id = subscription.price_id
        where subscription.environment = 'live'
          and subscription.stripe_subscription_id = new.stripe_subscription_id
          and mapping.lookup_key = 'pro_monthly';
      end if;

      new.price_id := coalesce(existing_pro_price_id, 'pro_monthly');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_legacy_live_subscription_price()
  from public, anon, authenticated, service_role;

commit;
