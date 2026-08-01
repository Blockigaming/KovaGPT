import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { resolveBillingPlan } from "@/lib/billing-plans";
import type { Database } from "@/integrations/supabase/types";

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
    metadata?: { lovable_external_id?: string };
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

function priceIdFrom(item: StripeLineItemLike | undefined): string | undefined {
  const candidates = [
    item?.price?.lookup_key,
    item?.price?.metadata?.lovable_external_id,
    item?.price?.id,
  ];
  for (const candidate of candidates) {
    const plan = resolveBillingPlan(candidate);
    if (plan) return plan.lookupKey;
  }
  return undefined;
}

async function handleSubscriptionCreated(subscription: StripeSubscriptionLike, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

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
      },
      { onConflict: "stripe_subscription_id" },
    );
}

async function handleSubscriptionUpdated(subscription: StripeSubscriptionLike, env: StripeEnv) {
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
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function handleSubscriptionDeleted(subscription: StripeSubscriptionLike, env: StripeEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  // Idempotency: skip if this Stripe event id has already been processed.
  const eventId = event.id;
  if (eventId) {
    const { error: insertErr } = await getSupabase()
      .from("processed_stripe_events")
      .insert({ event_id: eventId, type: event.type, environment: env } as never);
    if (insertErr) {
      // Unique-violation => already processed; any other error => log and bail safely.
      if ((insertErr as { code?: string }).code === "23505") {
        console.log("Duplicate Stripe event ignored:", eventId);
        return;
      }
      console.error("Failed to record Stripe event:", insertErr);
      return;
    }
  }

  switch (event.type) {
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object as StripeSubscriptionLike, env);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as StripeSubscriptionLike, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as StripeSubscriptionLike, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "live") {
          console.error("Webhook invalid env:", rawEnv);
          return Response.json({ error: "invalid_environment" }, { status: 400 });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
