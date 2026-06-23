
INSERT INTO public.subscriptions (
  user_id, stripe_subscription_id, stripe_customer_id, product_id, price_id,
  status, current_period_start, current_period_end, cancel_at_period_end, environment
) VALUES
  ('381887de-16c6-4120-8fc1-a0f7767c4d54', 'comp_pro_live_381887de', 'comp_cust_381887de', 'pro_plan', 'pro_monthly',
   'active', now(), now() + interval '100 years', false, 'live'),
  ('381887de-16c6-4120-8fc1-a0f7767c4d54', 'comp_pro_sandbox_381887de', 'comp_cust_sb_381887de', 'pro_plan', 'pro_monthly',
   'active', now(), now() + interval '100 years', false, 'sandbox')
ON CONFLICT (stripe_subscription_id) DO UPDATE SET
  status = 'active',
  current_period_end = now() + interval '100 years',
  cancel_at_period_end = false,
  updated_at = now();
