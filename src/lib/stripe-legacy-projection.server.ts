// Separately versioned compatibility projection. Existing subscriptions/trials
// retain the legacy schema; ownership and writes are atomic in the policy RPC.
// Known Git source6344547 informed the adapter, not an image-source attestation.
import { type StripeEnv, type VerifiedStripeEvent } from "@/lib/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { loose } from "@/lib/supabase-loose";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.deleted",
]);
const INVOICE_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);
const CHECKOUT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
]);
const STATUSES = new Set([
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
]);
// Read existing subscriptions at the retired Price without offering it to new
// Checkout. The accepted 20260913013131 registration retains this exact mapping.
const RETIRED_PRO_PRICE_ID = "price_1UAzhRAEZlsb6DBYlafU4mhc";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("legacy_event_object_invalid");
  return value as JsonRecord;
}
function objectId(value: unknown, prefix: string): string {
  const candidate = typeof value === "string" ? value : record(value).id;
  if (
    typeof candidate !== "string" ||
    !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`, "u").test(candidate)
  )
    throw new Error("legacy_event_identity_invalid");
  return candidate;
}
function timestamp(seconds: unknown): string {
  if (
    typeof seconds !== "number" ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 253402300799
  )
    throw new Error("legacy_event_timestamp_invalid");
  return new Date(seconds * 1000).toISOString();
}
function invoiceSubscription(invoice: JsonRecord): string | null {
  const direct = invoice.subscription == null ? null : objectId(invoice.subscription, "sub");
  const parent = invoice.parent == null ? null : record(invoice.parent);
  const details =
    parent?.type === "subscription_details" ? record(parent.subscription_details) : null;
  const nested = details?.subscription == null ? null : objectId(details.subscription, "sub");
  if (direct && nested && direct !== nested)
    throw new Error("legacy_event_subscription_binding_invalid");
  return direct ?? nested;
}

export function billingOutcome(type: string): string {
  if (type === "checkout.session.completed") return "verification_pending";
  if (type === "checkout.session.expired") return "checkout_expired";
  if (type === "invoice.paid") return "payment_confirmed";
  if (type === "invoice.payment_failed") return "payment_failed";
  if (type === "invoice.payment_action_required") return "payment_action_required";
  if (["invoice.voided", "invoice.marked_uncollectible"].includes(type))
    return "payment_uncollectible";
  if (type === "customer.subscription.deleted") return "subscription_ended";
  if (type.startsWith("customer.subscription.")) return "subscription_updated";
  return "observed";
}

/** Only allowlisted fields cross the database boundary. Metadata never selects an owner. */
export function normalizeLegacyStripeEvent(
  event: VerifiedStripeEvent,
  env: StripeEnv,
  correlationId: string,
) {
  if (!["sandbox", "live"].includes(env) || event.livemode !== (env === "live"))
    throw new Error("legacy_event_environment_invalid");
  const eventId = objectId(event.id, "evt");
  const createdAt = timestamp(event.created);
  if (
    !SUBSCRIPTION_EVENTS.has(event.type) &&
    !INVOICE_EVENTS.has(event.type) &&
    !CHECKOUT_EVENTS.has(event.type)
  )
    return null;
  const object = record(event.data.object);
  const customerId = objectId(object.customer, "cus");
  let subscriptionId: string | null;
  let invoiceId: string | null = null;
  let checkoutSessionId: string | null = null;
  let projection: JsonRecord | null = null;
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    subscriptionId = objectId(object.id, "sub");
    if (event.type === "customer.subscription.deleted") {
      projection = {
        kind: "subscription_deleted",
        stripeSubscriptionId: subscriptionId,
        customerId,
        status: "canceled",
      };
    } else {
      const items = record(object.items);
      if (items.has_more !== false || !Array.isArray(items.data) || items.data.length !== 1)
        throw new Error("legacy_event_subscription_items_invalid");
      const item = record(items.data[0]);
      const price = record(item.price);
      const stripePriceId = objectId(price.id, "price");
      const plan =
        resolveBillingPlan(stripePriceId) ??
        (stripePriceId === RETIRED_PRO_PRICE_ID ? resolveBillingPlan("pro_monthly") : null);
      // Source pins only live Prices. Sandbox/historical unknown Price ids need
      // separate qualification, never a user-editable metadata entitlement guess.
      if (
        env !== "live" ||
        !plan ||
        (stripePriceId !== plan.livePriceId && stripePriceId !== RETIRED_PRO_PRICE_ID) ||
        (price.lookup_key != null && price.lookup_key !== plan.lookupKey)
      )
        throw new Error("legacy_event_price_unqualified");
      if (
        typeof object.status !== "string" ||
        !STATUSES.has(object.status) ||
        typeof object.cancel_at_period_end !== "boolean"
      )
        throw new Error("legacy_event_subscription_status_invalid");
      const periodStart = timestamp(item.current_period_start ?? object.current_period_start);
      const periodEnd = timestamp(item.current_period_end ?? object.current_period_end);
      if (periodEnd <= periodStart) throw new Error("legacy_event_subscription_period_invalid");
      projection = {
        kind: "subscription",
        stripeSubscriptionId: subscriptionId,
        customerId,
        productId: objectId(price.product, "prod"),
        // Mutable lookup keys cannot identify a paid subscription. Preserve the
        // authenticated event's exact Price for the exact-ID tier authority.
        priceId: stripePriceId,
        status: object.status,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd: object.cancel_at_period_end,
      };
    }
  } else if (INVOICE_EVENTS.has(event.type)) {
    invoiceId = objectId(object.id, "in");
    subscriptionId = invoiceSubscription(object);
    if (subscriptionId) {
      projection = {
        kind: "invoice_status",
        stripeSubscriptionId: subscriptionId,
        customerId,
        status:
          event.type === "invoice.paid"
            ? "active"
            : event.type === "invoice.payment_action_required"
              ? "incomplete"
              : "past_due",
      };
    }
  } else {
    checkoutSessionId = objectId(object.id, "cs");
    subscriptionId = object.subscription == null ? null : objectId(object.subscription, "sub");
  }
  return {
    eventId,
    type: event.type,
    createdAt,
    correlationId: UUID.test(correlationId) ? correlationId : null,
    objectId: invoiceId ?? checkoutSessionId ?? subscriptionId,
    customerId,
    subscriptionId,
    invoiceId,
    checkoutSessionId,
    outcome: billingOutcome(event.type),
    projection,
  };
}

export async function projectLegacyStripeEvent(
  event: VerifiedStripeEvent,
  env: StripeEnv,
  correlationId: string = crypto.randomUUID(),
) {
  const normalized = normalizeLegacyStripeEvent(event, env, correlationId);
  if (!normalized) return { duplicate: false, ignored: true };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 16 * 1024)
    throw new Error("legacy_event_normalized_size_exceeded");
  const result = await loose(supabaseAdmin)
    .rpc("kova_policy_apply_legacy_event", {
      p_environment: env,
      p_event: normalized,
    })
    .abortSignal(AbortSignal.timeout(10_000));
  if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data))
    throw new Error("legacy_subscription_atomic_projection_failed");
  const value = result.data as { duplicate?: unknown; outcome?: unknown };
  if (
    typeof value.duplicate !== "boolean" ||
    typeof value.outcome !== "string" ||
    ![
      "applied",
      "stale_ignored",
      "orphaned",
      "observed",
      "same_state",
      "already_processed",
    ].includes(value.outcome) ||
    value.duplicate !== (value.outcome === "already_processed")
  )
    throw new Error("legacy_subscription_atomic_result_invalid");
  return { duplicate: value.duplicate, orphaned: value.outcome === "orphaned" };
}
