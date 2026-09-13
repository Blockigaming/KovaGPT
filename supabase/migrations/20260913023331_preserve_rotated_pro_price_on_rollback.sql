begin;

-- A rolled-back webhook revision persists the shared lookup key instead of
-- Stripe's exact Price ID. Pro now has two live Price IDs, so a fresh lookup-
-- key write is ambiguous. Preserve the exact ID already attached to the
-- subscription and reject novel ambiguous writes rather than relabeling an
-- $80 subscription as the historical $89 Price (or vice versa).
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
        -- current row here keeps a legacy upsert tied to its exact Price ID.
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

      if existing_pro_price_id is null then
        -- A Checkout that completed immediately before rollback may not have
        -- produced its first subscription row yet. The durable attempt was
        -- created before Stripe received the Session request and retains the
        -- exact Price ID even though the old webhook reduces it to a lookup
        -- key. Only a request that progressed past the pre-POST `new` state is
        -- authoritative for this recovery path.
        select mapping.stripe_price_id
        into existing_pro_price_id
        from public.stripe_checkout_attempts as attempt
        join public.billing_plan_tiers as mapping
          on mapping.environment = attempt.environment
         and mapping.stripe_price_id = attempt.stripe_price_id
        where attempt.environment = 'live'
          and attempt.user_id = new.user_id
          and attempt.outcome in ('pending', 'ready', 'complete')
          and mapping.lookup_key = 'pro_monthly';
      end if;

      if existing_pro_price_id is null then
        raise exception 'ambiguous_legacy_live_pro_price'
          using errcode = '23514';
      end if;
      new.price_id := existing_pro_price_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_legacy_live_subscription_price()
  from public, anon, authenticated, service_role;

commit;
