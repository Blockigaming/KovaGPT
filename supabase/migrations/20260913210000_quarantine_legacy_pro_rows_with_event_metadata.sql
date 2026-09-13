begin;

-- Migration 20260913153000 was already eligible for deployment before its
-- quarantine predicate was corrected. Preserve that migration's checksum and
-- apply the broader repair under a new version so upgraded databases execute
-- it. The rollback webhook stamped event time and ID before the authoritative
-- observation-sequence protocol existed; only a non-null observation sequence
-- proves that the exact Price came from the current reconciliation path.
alter table public.subscriptions
  disable trigger normalize_legacy_live_subscription_price;

update public.subscriptions as subscription
set price_id = 'pro_monthly',
    updated_at = now()
from public.stripe_checkout_attempts as attempt
join public.billing_plan_tiers as mapping
  on mapping.environment = attempt.environment
 and mapping.stripe_price_id = attempt.stripe_price_id
where subscription.environment = 'live'
  and attempt.environment = subscription.environment
  and attempt.user_id = subscription.user_id
  and attempt.stripe_price_id = subscription.price_id
  and attempt.outcome in ('pending', 'ready', 'complete')
  and mapping.lookup_key = 'pro_monthly'
  and subscription.created_at >= attempt.created_at
  and subscription.last_stripe_observation_sequence is null;

alter table public.subscriptions
  enable trigger normalize_legacy_live_subscription_price;

commit;
