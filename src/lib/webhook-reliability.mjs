const POSTGRES_UNIQUE_VIOLATION = "23505";

export class WebhookProcessingError extends Error {
  constructor(code, status = 500, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "WebhookProcessingError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 500, cause) {
  throw new WebhookProcessingError(code, status, cause);
}

function requireResult(result, code, { requireData = false } = {}) {
  if (result?.error) fail(code, 500, result.error);
  if (requireData && !result?.data) fail(`${code}_no_rows`);
  return result?.data ?? null;
}

function affectedRows(result, code) {
  const data = requireResult(result, code);
  if (!Array.isArray(data)) fail(`${code}_missing_affected_rows`);
  return data.length;
}

function stringId(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id) {
    return value.id;
  }
  return null;
}

export function invoiceSubscriptionId(invoice) {
  if (invoice?.parent?.type !== "subscription_details") return null;
  return stringId(invoice.parent.subscription_details?.subscription);
}

function eventSubscriptionId(event) {
  if (event.type.startsWith("customer.subscription.")) return stringId(event.data?.object);
  if (event.type.startsWith("invoice.")) return invoiceSubscriptionId(event.data?.object);
  return null;
}

function subscriptionRow(subscription, eventType, environment, userId, resolvePriceId, now, event) {
  const item = subscription?.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const customerId = stringId(subscription?.customer);
  const productId = stringId(item?.price?.product);

  if (!subscription?.id || !item || !priceId || !customerId || !productId) {
    fail("authoritative_subscription_incomplete");
  }

  const periodStart = item.current_period_start ?? subscription.current_period_start;
  const periodEnd = item.current_period_end ?? subscription.current_period_end;

  return {
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    product_id: productId,
    price_id: priceId,
    status: eventType === "customer.subscription.deleted" ? "canceled" : subscription.status,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end:
      eventType === "customer.subscription.deleted" || Boolean(subscription.cancel_at_period_end),
    environment,
    updated_at: now(),
    last_stripe_event_created_at: new Date(event.created * 1000).toISOString(),
    last_stripe_event_id: event.id,
  };
}

const subscriptionEvents = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const invoiceEvents = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

async function mappedUserId(supabase, environment, customerId) {
  const result = await supabase
    .from("stripe_customer_mappings")
    .select("user_id")
    .eq("environment", environment)
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  const mapping = requireResult(result, "stripe_customer_mapping_lookup_failed", {
    requireData: true,
  });
  if (typeof mapping.user_id !== "string" || !mapping.user_id) {
    fail("stripe_customer_mapping_missing");
  }
  return mapping.user_id;
}

async function currentSubscriptionTimestamp(supabase, environment, subscriptionId) {
  const result = await supabase
    .from("subscriptions")
    .select("last_stripe_event_created_at")
    .eq("environment", environment)
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  return requireResult(result, "subscription_event_order_lookup_failed")
    ?.last_stripe_event_created_at;
}

function isCurrentEvent(created, persisted) {
  if (!persisted) return true;
  return created * 1000 >= Date.parse(persisted);
}

export async function processStripeEvent({
  supabase,
  event,
  environment,
  resolvePriceId,
  retrieveSubscription,
  billingOutcome = () => "observed",
  correlationId = null,
  now = () => new Date().toISOString(),
}) {
  if (
    !event?.id ||
    !event?.type ||
    !Number.isSafeInteger(event.created) ||
    !event?.data ||
    !("object" in event.data)
  ) {
    fail("stripe_event_incomplete", 400);
  }
  if (environment !== "sandbox" && environment !== "live") {
    fail("stripe_environment_invalid", 400);
  }

  const existing = await supabase
    .from("processed_stripe_events")
    .select("event_id")
    .eq("environment", environment)
    .eq("event_id", event.id)
    .maybeSingle();
  if (requireResult(existing, "stripe_event_lookup_failed")) {
    return { duplicate: true };
  }

  const subscriptionId = eventSubscriptionId(event);
  let authoritativeSubscription = null;
  if (subscriptionEvents.has(event.type) || (invoiceEvents.has(event.type) && subscriptionId)) {
    if (!subscriptionId) fail("stripe_subscription_id_missing");
    try {
      authoritativeSubscription = await retrieveSubscription(subscriptionId);
    } catch (error) {
      fail("stripe_subscription_retrieve_failed", 500, error);
    }
    if (!authoritativeSubscription || authoritativeSubscription.id !== subscriptionId) {
      fail("stripe_subscription_retrieve_mismatch");
    }

    const customerId = stringId(authoritativeSubscription.customer);
    if (!customerId) fail("stripe_subscription_customer_missing");
    const userId = await mappedUserId(supabase, environment, customerId);
    const persisted = await currentSubscriptionTimestamp(supabase, environment, subscriptionId);
    if (isCurrentEvent(event.created, persisted)) {
      const row = subscriptionRow(
        authoritativeSubscription,
        event.type,
        environment,
        userId,
        resolvePriceId,
        now,
        event,
      );
      const mutated = await supabase
        .from("subscriptions")
        .upsert(row, { onConflict: "stripe_subscription_id,environment" })
        .select("stripe_subscription_id")
        .maybeSingle();
      requireResult(mutated, "subscription_upsert_failed", {
        requireData: true,
      });
    }
  }

  const object = event.data.object;
  const customerId =
    stringId(authoritativeSubscription?.customer) ?? stringId(object?.customer) ?? null;
  const recorded = await supabase
    .from("processed_stripe_events")
    .insert({
      event_id: event.id,
      type: event.type,
      environment,
      processed_at: now(),
      event_created_at: new Date(event.created * 1000).toISOString(),
      correlation_id:
        typeof correlationId === "string" && /^[0-9a-f-]{36}$/iu.test(correlationId)
          ? correlationId
          : null,
      object_id: stringId(object),
      customer_id: customerId,
      subscription_id: subscriptionId,
      invoice_id: event.type.startsWith("invoice.") ? stringId(object) : null,
      checkout_session_id: event.type.startsWith("checkout.session.") ? stringId(object) : null,
      outcome: billingOutcome(event.type),
      retryable: false,
    })
    .select("event_id")
    .maybeSingle();
  if (recorded?.error?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { duplicate: true };
  }
  requireResult(recorded, "stripe_event_record_failed", { requireData: true });
  return { duplicate: false };
}

async function deliveryStatus(supabase, delivery) {
  const result = await supabase
    .from("github_webhook_deliveries")
    .select("delivery_id,status")
    .eq("delivery_id", delivery)
    .maybeSingle();
  return requireResult(result, "github_delivery_lookup_failed", {
    requireData: true,
  });
}

async function markGitHubDelivery(supabase, delivery, values, code) {
  const result = await supabase
    .from("github_webhook_deliveries")
    .update(values)
    .eq("delivery_id", delivery)
    .select("delivery_id")
    .maybeSingle();
  requireResult(result, code, { requireData: true });
}

export async function processGitHubDelivery({
  supabase,
  delivery,
  event,
  payload,
  supported,
  now = () => new Date().toISOString(),
}) {
  if (!delivery || !event) fail("github_delivery_incomplete", 400);

  const installationId = payload?.installation?.id ?? null;
  const repositoryId = payload?.repository?.id ?? null;
  const status = supported.has(event) ? "received" : "ignored";
  const inserted = await supabase
    .from("github_webhook_deliveries")
    .insert({
      delivery_id: delivery,
      event,
      installation_id: installationId,
      repository_id: repositoryId,
      action: payload?.action,
      status,
      signature_valid: true,
    })
    .select("delivery_id,status")
    .maybeSingle();

  if (inserted?.error) {
    if (inserted.error.code !== POSTGRES_UNIQUE_VIOLATION) {
      fail("github_delivery_record_failed", 500, inserted.error);
    }
    const existing = await deliveryStatus(supabase, delivery);
    if (existing.status === "processed" || existing.status === "ignored") {
      return { duplicate: true };
    }
  } else {
    requireResult(inserted, "github_delivery_record_failed", {
      requireData: true,
    });
  }

  try {
    if (event === "installation" && payload?.action === "deleted") {
      if (!installationId) fail("github_installation_id_missing", 422);
      const revoked = await supabase
        .from("github_installations")
        .delete()
        .eq("id", installationId)
        .select("id");
      affectedRows(revoked, "github_installation_revoke_failed");
    }

    if (
      event === "repository" &&
      ["deleted", "archived", "transferred"].includes(payload?.action)
    ) {
      if (!repositoryId) fail("github_repository_id_missing", 422);
      let revoke = supabase
        .from("github_repositories")
        .update({ explicitly_granted: false, revoked_at: now() })
        .eq("id", repositoryId);
      if (installationId) revoke = revoke.eq("installation_id", installationId);
      affectedRows(await revoke.select("id"), "github_repository_revoke_failed");
    }

    if (repositoryId) {
      let touch = supabase
        .from("github_repositories")
        .update({ last_webhook_at: now() })
        .eq("id", repositoryId);
      if (installationId) touch = touch.eq("installation_id", installationId);
      affectedRows(await touch.select("id"), "github_repository_touch_failed");
    }

    await markGitHubDelivery(
      supabase,
      delivery,
      {
        status: supported.has(event) ? "processed" : "ignored",
        processed_at: now(),
        redacted_error: null,
      },
      "github_delivery_finalize_failed",
    );
    return { duplicate: false };
  } catch (error) {
    try {
      await markGitHubDelivery(
        supabase,
        delivery,
        { status: "failed", redacted_error: { code: "processing_failed" } },
        "github_delivery_failure_status_failed",
      );
    } catch (statusError) {
      console.error("Failed to persist GitHub webhook failure status", statusError);
    }
    throw error instanceof WebhookProcessingError
      ? error
      : new WebhookProcessingError("github_processing_failed", 500, error);
  }
}
