-- Register the approved $80/month Pro Price while retaining the historical
-- $89/month mapping for existing subscriptions, webhook replay, and rollback.

begin;

insert into public.billing_plan_tiers (
  environment,
  stripe_price_id,
  lookup_key,
  tier
)
values (
  'live',
  'price_1UEw6FAEZlsb6DBYuksCKOBR',
  'pro_monthly',
  'pro'
)
on conflict (environment, stripe_price_id) do update
set lookup_key = excluded.lookup_key,
    tier = excluded.tier;

commit;
