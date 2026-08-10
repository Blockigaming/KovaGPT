-- This historical compensation belongs only to the named production account.
-- A clean development, CI, staging, or disaster-recovery database must not
-- create a synthetic Auth user merely to satisfy these data-only rows.
WITH compensation_rows (
  user_id,
  stripe_subscription_id,
  stripe_customer_id,
  product_id,
  price_id,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  environment
) AS (
  VALUES
    (
      '381887de-16c6-4120-8fc1-a0f7767c4d54'::uuid,
      'comp_pro_live_381887de',
      'comp_cust_381887de',
      'pro_plan',
      'pro_monthly',
      'active',
      now(),
      now() + interval '100 years',
      false,
      'live'
    ),
    (
      '381887de-16c6-4120-8fc1-a0f7767c4d54'::uuid,
      'comp_pro_sandbox_381887de',
      'comp_cust_sb_381887de',
      'pro_plan',
      'pro_monthly',
      'active',
      now(),
      now() + interval '100 years',
      false,
      'sandbox'
    )
)
INSERT INTO public.subscriptions (
  user_id,
  stripe_subscription_id,
  stripe_customer_id,
  product_id,
  price_id,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  environment
)
SELECT
  compensation.user_id,
  compensation.stripe_subscription_id,
  compensation.stripe_customer_id,
  compensation.product_id,
  compensation.price_id,
  compensation.status,
  compensation.current_period_start,
  compensation.current_period_end,
  compensation.cancel_at_period_end,
  compensation.environment
FROM compensation_rows AS compensation
WHERE EXISTS (
  SELECT 1
  FROM auth.users AS intended_user
  WHERE intended_user.id = compensation.user_id
)
ON CONFLICT (stripe_subscription_id) DO UPDATE SET
  status = 'active',
  current_period_end = now() + interval '100 years',
  cancel_at_period_end = false,
  updated_at = now();
