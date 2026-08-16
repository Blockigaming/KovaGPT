import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { logOperationalEvent } from "@/lib/structured-log.server";
import { correlationHeaders, correlationId as resolveCorrelationId } from "@/lib/correlation";

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

type StripeLineItemLike = {
  price?: {
    lookup_key?: string;
    metadata?: { kova_plan?: string; lovable_external_id?: string };
    id?: string;
    product?: string;
  };
  current_period_start?: number;
  current_period_end?: number;
};
type StripeSubscriptionLike = {
  id: string;
  customer?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: { userId?: string };
  items?: { data?: StripeLineItemLike[] };
};
type StripeLifecycleObject = {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  metadata?: { userId?: string };
};

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

export function normalizeStripeEnvironment(value: string | null): StripeEnv | null {
  return value === "sandbox" || value === "live" ? value : null;
}

function priceIdFrom(item: StripeLineItemLike | undefined): string | undefined {
  const candidates = [
    item?.price?.lookup_key,
    item?.price?.metadata?.kova_plan,
    // Temporary read-only compatibility for existing Stripe metadata. Remove
    // after the dashboard metadata has been migrated to kova_plan.
    item?.price?.metadata?.lovable_external_id,
    item?.price?.id,
  ];
  for (const candidate of candidates) {
    const plan = resolveBillingPlan(candidate);
    if (plan) return plan.lookupKey;
  }
  return undefined;
}

async function handleSubscriptionCreated(
  subscription: StripeSubscriptionLike,
  env: StripeEnv,
  eventCreated?: number,
  eventId?: string,
) {
  const userId = subscription.metadata?.userId;
  if (!userId) throw new Error("stripe_customer_mapping_missing");
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  const { data: existing } = await getSupabase()
    .from("subscriptions")
    .select("last_stripe_event_created_at")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();
  if (!isStripeEventCurrent(eventCreated, existing?.last_stripe_event_created_at)) return;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer ?? "",
        product_id: item?.price?.product ?? "",
        price_id: priceIdFrom(item) ?? "",
        status: subscription.status ?? "unknown",
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        environment: env,
        updated_at: new Date().toISOString(),
        last_stripe_event_created_at: eventCreated
          ? new Date(eventCreated * 1000).toISOString()
          : null,
        last_stripe_event_id: eventId ?? null,
      },
      { onConflict: "stripe_subscription_id" },
    );
}

export function isStripeEventCurrent(
  incomingSeconds: number | undefined,
  persisted: string | null | undefined,
): boolean {
  if (!incomingSeconds || !persisted) return true;
  return incomingSeconds * 1000 >= Date.parse(persisted);
}

async function handleSubscriptionUpdated(
  subscription: StripeSubscriptionLike,
  env: StripeEnv,
  eventCreated?: number,
  eventId?: string,
) {
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase()
    .from("subscriptions")
    .update({
      status: subscription.status ?? "unknown",
      product_id: item?.price?.product ?? "",
      price_id: priceIdFrom(item) ?? "",
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
      last_stripe_event_created_at: eventCreated
        ? new Date(eventCreated * 1000).toISOString()
        : null,
      last_stripe_event_id: eventId ?? null,
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .or(
      `last_stripe_event_created_at.is.null,last_stripe_event_created_at.lte.${eventCreated ? new Date(eventCreated * 1000).toISOString() : new Date().toISOString()}`,
    );
}

async function handleSubscriptionDeleted(
  subscription: StripeSubscriptionLike,
  env: StripeEnv,
  eventCreated?: number,
  eventId?: string,
) {
  await getSupabase()
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
      last_stripe_event_created_at: eventCreated
        ? new Date(eventCreated * 1000).toISOString()
        : null,
      last_stripe_event_id: eventId ?? null,
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .or(
      `last_stripe_event_created_at.is.null,last_stripe_event_created_at.lte.${eventCreated ? new Date(eventCreated * 1000).toISOString() : new Date().toISOString()}`,
    );
}

export async function handleWebhook(
  req: Request,
  env: StripeEnv,
  correlationId: string = crypto.randomUUID(),
) {
  const event = await verifyWebhook(req, env);
  const eventCreated =
    typeof (event as { created?: unknown }).created === "number"
      ? (event as { created: number }).created
      : undefined;

  const eventId = event.id;
  const object = event.data.object as StripeLifecycleObject;
  if (eventId) {
    const { error: insertErr } = await getSupabase()
      .from("processed_stripe_events")
      .insert({
        event_id: eventId,
        type: event.type,
        environment: env,
        event_created_at: eventCreated ? new Date(eventCreated * 1000).toISOString() : null,
        correlation_id: /^[0-9a-f-]{36}$/iu.test(correlationId) ? correlationId : null,
        object_id: object.id ?? null,
        customer_id: typeof object.customer === "string" ? object.customer : null,
        subscription_id:
          typeof object.subscription === "string"
            ? object.subscription
            : event.type.startsWith("customer.subscription.")
              ? object.id
              : null,
        invoice_id: event.type.startsWith("invoice.") ? object.id : null,
        checkout_session_id: event.type.startsWith("checkout.session.") ? object.id : null,
        outcome: billingOutcome(event.type),
        retryable: false,
      } as never);
    if (insertErr) {
      if ((insertErr as { code?: string }).code === "23505") return { duplicate: true };
      throw new Error("stripe_event_claim_failed");
    }
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as StripeSubscriptionLike,
          env,
          eventCreated,
          eventId,
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as StripeSubscriptionLike,
          env,
          eventCreated,
          eventId,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as StripeSubscriptionLike,
          env,
          eventCreated,
          eventId,
        );
        break;
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await handleSubscriptionUpdated(
          event.data.object as StripeSubscriptionLike,
          env,
          eventCreated,
          eventId,
        );
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.payment_action_required":
      case "invoice.voided":
      case "invoice.marked_uncollectible": {
        const invoice = event.data.object as StripeLifecycleObject;
        if (typeof invoice.subscription === "string") {
          const status =
            event.type === "invoice.paid"
              ? "active"
              : event.type === "invoice.payment_action_required"
                ? "incomplete"
                : "past_due";
          await getSupabase()
            .from("subscriptions")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", invoice.subscription)
            .eq("environment", env)
            .or(
              `last_stripe_event_created_at.is.null,last_stripe_event_created_at.lte.${eventCreated ? new Date(eventCreated * 1000).toISOString() : new Date().toISOString()}`,
            );
        }
        break;
      }
      case "checkout.session.completed":
      case "checkout.session.expired":
        break;
    }
    logOperationalEvent({
      correlationId,
      category: "billing",
      operation: "stripe_webhook_processed",
      metadata: { eventType: event.type, environment: env },
    });
    return { duplicate: false };
  } catch {
    if (eventId)
      await getSupabase().from("processed_stripe_events").delete().eq("event_id", eventId);
    throw new Error("stripe_event_processing_failed");
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
        const environment = normalizeStripeEnvironment(new URL(request.url).searchParams.get("env"));
        if (!environment) {
          return Response.json({ error: "invalid_environment", correlationId }, { status: 400 });
        }
        try {
          const result = await handleWebhook(request, environment, correlationId);
          return Response.json(
            { received: true, duplicate: result.duplicate, correlationId },
            { headers: correlationHeaders(correlationId) },
          );
        } catch {
          logOperationalEvent({
            correlationId,
            category: "billing",
            operation: "stripe_webhook_rejected",
            metadata: { environment },
          });
          return Response.json({ error: "webhook_rejected", correlationId }, { status: 400 });
        }
      },
    },
  },
});
