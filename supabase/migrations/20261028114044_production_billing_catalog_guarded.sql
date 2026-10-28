-- Register only the three verified live recurring Stripe Prices. This does not
-- create a subscription, grant an entitlement, or activate Checkout.
-- A changed production billing baseline needs separate reconciliation.
begin;

lock table public.subscriptions, public.billing_plan_tiers
  in share row exclusive mode;

do $$
declare
  blocking_checkout_attempt boolean := false;
begin
  -- The audited production baseline predates this optional table. If a later
  -- revision created it, hold its writes and refuse an in-flight attempt.
  if to_regclass('public.stripe_checkout_attempts') is not null then
    execute 'lock table public.stripe_checkout_attempts in share row exclusive mode';
    execute $query$
      select exists (
        select 1 from public.stripe_checkout_attempts
        where environment = 'live'
          and (
            outcome <> 'expired'
            or session_expires_at > now()
            or idempotency_expires_at > now()
          )
      )
    $query$ into blocking_checkout_attempt;
  end if;

  if exists (select 1 from public.subscriptions)
     or blocking_checkout_attempt then
    raise exception 'billing_catalog_baseline_changed' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.billing_plan_tiers as mapping
    where mapping.environment = 'live'
      and not (
        (mapping.stripe_price_id = 'price_1UAzhHAEZlsb6DBYWw2oUCeO'
          and mapping.lookup_key = 'plus_monthly' and mapping.tier = 'plus')
        or (mapping.stripe_price_id = 'price_1UEw6FAEZlsb6DBYuksCKOBR'
          and mapping.lookup_key = 'pro_monthly' and mapping.tier = 'pro')
        or (mapping.stripe_price_id = 'price_1UAzhRAEZlsb6DBYlafU4mhc'
          and mapping.lookup_key = 'pro_monthly' and mapping.tier = 'pro')
      )
  ) then
    raise exception 'billing_catalog_mapping_conflict' using errcode = 'P0001';
  end if;
end;
$$;

insert into public.billing_plan_tiers (
  environment, stripe_price_id, lookup_key, tier
)
values
  ('live', 'price_1UAzhHAEZlsb6DBYWw2oUCeO', 'plus_monthly', 'plus'),
  ('live', 'price_1UEw6FAEZlsb6DBYuksCKOBR', 'pro_monthly', 'pro'),
  ('live', 'price_1UAzhRAEZlsb6DBYlafU4mhc', 'pro_monthly', 'pro')
on conflict (environment, stripe_price_id) do nothing;

do $$
begin
  if (select count(*) from public.billing_plan_tiers where environment = 'live') <> 3
  then
    raise exception 'billing_catalog_postcondition_failed' using errcode = 'P0001';
  end if;
end;
$$;

commit;
