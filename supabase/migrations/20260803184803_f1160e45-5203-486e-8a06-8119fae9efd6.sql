ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS last_stripe_event_id text;