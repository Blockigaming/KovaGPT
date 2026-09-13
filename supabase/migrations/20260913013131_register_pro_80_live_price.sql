-- Register the approved $80/month Pro Price without removing the retired
-- $89 Price mapping needed to resolve historical subscriptions and webhooks.

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
