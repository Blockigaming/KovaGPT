const POSTGRES_UNIQUE_VIOLATION = "23505";

export class WebhookProcessingError extends Error {
  constructor(code, status = 500, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "WebhookProcessingError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status, cause) {
  throw new WebhookProcessingError(code, status, cause);
}

function requireResult(result, code, { requireData = false } = {}) {
  if (result?.error) fail(code, 500, result.error);
  if (requireData && !result?.data) fail(`${code}_no_rows`, 500);
  return result?.data ?? null;
}

function affectedRows(result, code) {
  const data = requireResult(result, code);
  if (!Array.isArray(data)) fail(`${code}_missing_affected_rows`, 500);
  return data.length;
}

function stringId(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id) {
    return value.id;
  }
  return null;
}

function unixTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid_${field}`, 422);
  return new Date(value * 1000).toISOString();
}

function subscriptionRow(subscription, eventType, environment, resolvePriceId) {
  const userId = subscription?.metadata?.userId;
  const item = subscription?.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const customerId = stringId(subscription?.customer);
  const productId = stringId(item?.price?.product);
  const status = eventType === "customer.subscription.deleted" ? "canceled" : subscription?.status;

  if (
    !subscription?.id ||
    !userId ||
    !item ||
    !priceId ||
    !customerId ||
    !productId ||
    typeof status !== "string" ||
    !status
  ) {
    fail("subscription_metadata_incomplete", 422);
  }

  const periodStart = item.current_period_start ?? subscription.current_period_start;
  const periodEnd = item.current_period_end ?? subscription.current_period_end;

  return {
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    product_id: productId,
    price_id: priceId,
    status,
    current_period_start: unixTimestamp(periodStart, "subscription_period_start"),
    current_period_end: unixTimestamp(periodEnd, "subscription_period_end"),
    cancel_at_period_end:
      eventType === "customer.subscription.deleted" || Boolean(subscription.cancel_at_period_end),
    environment,
  };
}

const subscriptionReconciliationEvents = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

export function billingOutcome(type) {
  if (type === "checkout.session.completed") return "verification_pending";
  if (type === "checkout.session.expired") return "checkout_expired";
  if (type === "invoice.paid") return "payment_confirmed";
  if (type === "invoice.payment_failed") return "payment_failed";
  if (type === "invoice.payment_action_required") return "payment_action_required";
  if (["invoice.voided", "invoice.marked_uncollectible"].includes(type)) {
    return "payment_uncollectible";
  }
  if (type === "customer.subscription.deleted") return "subscription_ended";
  if (type.startsWith("customer.subscription.")) return "subscription_updated";
  return "observed";
}

export function stripeSubscriptionId(event) {
  if (!subscriptionReconciliationEvents.has(event?.type)) return null;
  const object = event?.data?.object;
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  if (event.type.startsWith("customer.subscription.")) return stringId(object);

  const direct = stringId(object.subscription);
  if (direct) return direct;
  return stringId(object.parent?.subscription_details?.subscription);
}

export async function processStripeEvent({
  supabase,
  event,
  environment,
  resolvePriceId,
  retrieveSubscription,
  correlationId = null,
}) {
  if (
    !event?.id ||
    !event?.type ||
    !Number.isSafeInteger(event.created) ||
    event.created < 1 ||
    (environment !== "live" && environment !== "sandbox")
  ) {
    fail("stripe_event_incomplete", 400);
  }

  const existing = await supabase
    .from("processed_stripe_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (requireResult(existing, "stripe_event_lookup_failed")) {
    return { duplicate: true, applied: false };
  }

  const eventObject = event.data?.object;
  if (!eventObject || typeof eventObject !== "object" || Array.isArray(eventObject)) {
    fail("stripe_event_object_invalid", 400);
  }

  const subscriptionId = stripeSubscriptionId(event);
  let subscription = null;
  if (subscriptionId) {
    if (typeof retrieveSubscription !== "function") {
      fail("stripe_subscription_retriever_missing", 500);
    }
    let canonical;
    try {
      canonical = await retrieveSubscription(subscriptionId);
    } catch (error) {
      fail("stripe_subscription_retrieval_failed", 503, error);
    }
    subscription = subscriptionRow(canonical, event.type, environment, resolvePriceId);
  }

  const result = await supabase.rpc("process_stripe_webhook_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_environment: environment,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_correlation_id: correlationId,
    p_object_id: stringId(eventObject),
    p_customer_id: stringId(eventObject.customer) ?? subscription?.stripe_customer_id ?? null,
    p_subscription_id: subscriptionId,
    p_invoice_id: event.type.startsWith("invoice.") ? stringId(eventObject) : null,
    p_checkout_session_id: event.type.startsWith("checkout.session.")
      ? stringId(eventObject)
      : null,
    p_outcome: billingOutcome(event.type),
    p_subscription: subscription,
  });
  const rows = requireResult(result, "stripe_event_transaction_failed");
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || typeof row.duplicate !== "boolean" || typeof row.applied !== "boolean") {
    fail("stripe_event_transaction_invalid", 500);
  }
  return { duplicate: row.duplicate, applied: row.applied };
}

async function deliveryStatus(supabase, delivery) {
  const result = await supabase
    .from("github_webhook_deliveries")
    .select("delivery_id,status")
    .eq("delivery_id", delivery)
    .maybeSingle();
  return requireResult(result, "github_delivery_lookup_failed", { requireData: true });
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
    requireResult(inserted, "github_delivery_record_failed", { requireData: true });
  }

  try {
    if (event === "installation" && payload?.action === "deleted") {
      if (!installationId) fail("github_installation_id_missing", 422);
      const revoked = await supabase
        .from("github_installations")
        .delete()
        .eq("id", installationId)
        .select("id");
      // Zero rows is an idempotent success: a prior attempt may have revoked it before
      // its final delivery-status write failed.
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
      // GitHub can deliver before repository discovery finishes, so an untracked row is a safe no-op.
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
