-- Persist a Stripe event and its canonical subscription snapshot in one
-- transaction. The service-role-only RPC makes duplicate delivery, retries,
-- concurrent workers, and out-of-order events explicit database invariants.
create or replace function public.process_stripe_webhook_event(
  p_event_id text,
  p_type text,
  p_environment text,
  p_event_created_at timestamptz,
  p_correlation_id uuid,
  p_object_id text,
  p_customer_id text,
  p_subscription_id text,
  p_invoice_id text,
  p_checkout_session_id text,
  p_outcome text,
  p_subscription jsonb
)
returns table (duplicate boolean, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_event text;
  v_subscription_id text;
  v_user_id uuid;
  v_customer_id text;
  v_product_id text;
  v_price_id text;
  v_status text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
  v_existing_user_id uuid;
  v_existing_environment text;
  v_affected integer := 0;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 255 then
    raise exception 'invalid_stripe_event_id';
  end if;
  if p_type is null or length(p_type) not between 1 and 255 then
    raise exception 'invalid_stripe_event_type';
  end if;
  if p_environment not in ('sandbox', 'live') then
    raise exception 'invalid_stripe_environment';
  end if;
  if p_event_created_at is null or p_event_created_at > now() + interval '5 minutes' then
    raise exception 'invalid_stripe_event_timestamp';
  end if;
  if p_outcome is null or length(p_outcome) not between 1 and 100 then
    raise exception 'invalid_stripe_event_outcome';
  end if;

  insert into public.processed_stripe_events (
    event_id,
    type,
    environment,
    event_created_at,
    correlation_id,
    object_id,
    customer_id,
    subscription_id,
    invoice_id,
    checkout_session_id,
    outcome,
    retryable
  )
  values (
    p_event_id,
    p_type,
    p_environment,
    p_event_created_at,
    p_correlation_id,
    p_object_id,
    p_customer_id,
    p_subscription_id,
    p_invoice_id,
    p_checkout_session_id,
    p_outcome,
    false
  )
  on conflict (event_id) do nothing
  returning event_id into v_claimed_event;

  if v_claimed_event is null then
    return query select true, false;
    return;
  end if;

  if p_subscription is not null then
    if jsonb_typeof(p_subscription) <> 'object' then
      raise exception 'invalid_stripe_subscription_snapshot';
    end if;

    v_subscription_id := nullif(p_subscription ->> 'stripe_subscription_id', '');
    v_user_id := nullif(p_subscription ->> 'user_id', '')::uuid;
    v_customer_id := nullif(p_subscription ->> 'stripe_customer_id', '');
    v_product_id := nullif(p_subscription ->> 'product_id', '');
    v_price_id := nullif(p_subscription ->> 'price_id', '');
    v_status := nullif(p_subscription ->> 'status', '');
    v_period_start := nullif(p_subscription ->> 'current_period_start', '')::timestamptz;
    v_period_end := nullif(p_subscription ->> 'current_period_end', '')::timestamptz;
    v_cancel_at_period_end := coalesce(
      (p_subscription ->> 'cancel_at_period_end')::boolean,
      false
    );

    if v_subscription_id is null
      or v_user_id is null
      or v_customer_id is null
      or v_product_id is null
      or v_price_id is null
      or v_status is null
    then
      raise exception 'incomplete_stripe_subscription_snapshot';
    end if;
    if p_subscription_id is distinct from v_subscription_id then
      raise exception 'stripe_subscription_identity_mismatch';
    end if;
    if v_period_start is not null
      and v_period_end is not null
      and v_period_end <= v_period_start
    then
      raise exception 'invalid_stripe_subscription_period';
    end if;

    select user_id, environment
      into v_existing_user_id, v_existing_environment
      from public.subscriptions
     where stripe_subscription_id = v_subscription_id;
    if found and (
      v_existing_user_id is distinct from v_user_id
      or v_existing_environment is distinct from p_environment
    ) then
      raise exception 'stripe_subscription_owner_mismatch';
    end if;

    insert into public.subscriptions (
      user_id,
      stripe_subscription_id,
      stripe_customer_id,
      product_id,
      price_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      environment,
      updated_at,
      last_stripe_event_created_at,
      last_stripe_event_id
    )
    values (
      v_user_id,
      v_subscription_id,
      v_customer_id,
      v_product_id,
      v_price_id,
      v_status,
      v_period_start,
      v_period_end,
      v_cancel_at_period_end,
      p_environment,
      now(),
      p_event_created_at,
      p_event_id
    )
    on conflict (stripe_subscription_id) do update
      set stripe_customer_id = excluded.stripe_customer_id,
          product_id = excluded.product_id,
          price_id = excluded.price_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          updated_at = excluded.updated_at,
          last_stripe_event_created_at = excluded.last_stripe_event_created_at,
          last_stripe_event_id = excluded.last_stripe_event_id
    where public.subscriptions.user_id = excluded.user_id
      and public.subscriptions.environment = excluded.environment
      and (
        public.subscriptions.last_stripe_event_created_at is null
        or excluded.last_stripe_event_created_at > public.subscriptions.last_stripe_event_created_at
        or (
          excluded.last_stripe_event_created_at = public.subscriptions.last_stripe_event_created_at
          and excluded.last_stripe_event_id >= coalesce(public.subscriptions.last_stripe_event_id, '')
        )
      );
    get diagnostics v_affected = row_count;

    if v_affected = 0 and exists (
      select 1
        from public.subscriptions
       where stripe_subscription_id = v_subscription_id
         and (
           user_id is distinct from v_user_id
           or environment is distinct from p_environment
         )
    ) then
      raise exception 'stripe_subscription_owner_mismatch';
    end if;
  end if;

  return query select false, v_affected > 0;
end;
$$;

revoke all on function public.process_stripe_webhook_event(
  text,
  text,
  text,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.process_stripe_webhook_event(
  text,
  text,
  text,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;
