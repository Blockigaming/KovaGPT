import { createFileRoute } from "@tanstack/react-router";
import {
  createStripeClient,
  type StripeEnv,
  StripeWebhookVerificationError,
  verifyWebhook,
  durableStripeBillingEnabled,
} from "@/lib/stripe.server";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { logOperationalEvent } from "@/lib/structured-log.server";
import { correlationHeaders, correlationId as resolveCorrelationId } from "@/lib/correlation";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processStripeEvent, WebhookProcessingError } from "@/lib/webhook-reliability.mjs";

type StripeLineItemLike = {
  price?: {
    lookup_key?: string | null;
    metadata?: { kova_plan?: string };
    id?: string;
  };
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

async function priceIdFrom(value: unknown, environment: StripeEnv): Promise<string | undefined> {
  const item = value as StripeLineItemLike | undefined;
  const priceId = item?.price?.id;
  if (!priceId || !/^price_[A-Za-z0-9]+$/u.test(priceId)) return undefined;

  if (environment === "live") {
    const { data, error } = await supabaseAdmin
      .from("billing_plan_tiers")
      .select("stripe_price_id")
      .eq("environment", environment)
      .eq("stripe_price_id", priceId)
      .maybeSingle();
    if (error) {
      throw new WebhookProcessingError("stripe_price_registry_lookup_failed", 500, error);
    }
    return data?.stripe_price_id === priceId ? priceId : undefined;
  }

  const candidates = [item?.price?.lookup_key, item?.price?.metadata?.kova_plan, priceId];
  return candidates.some((candidate) => resolveBillingPlan(candidate)) ? priceId : undefined;
}

export async function handleWebhook(
  req: Request,
  env: StripeEnv,
  correlationId: string = crypto.randomUUID(),
) {
  const event = await verifyWebhook(req, env);
  if (!durableStripeBillingEnabled())
    throw new WebhookProcessingError("billing_rollout_pending", 503);
  const stripe = createStripeClient(env);
  return processStripeEvent({
    supabase: supabaseAdmin,
    event,
    environment: env,
    resolvePriceId: (item) => priceIdFrom(item, env),
    retrieveSubscription: (subscriptionId) => stripe.subscriptions.retrieve(subscriptionId),
    billingOutcome,
    correlationId,
  });
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
        const environment = normalizeStripeEnvironment(
          new URL(request.url).searchParams.get("env"),
        );
        if (!environment) {
          return Response.json(
            { error: "invalid_environment", correlationId },
            {
              status: 400,
              headers: {
                ...correlationHeaders(correlationId),
                "Cache-Control": "no-store",
              },
            },
          );
        }
        try {
          const result = await handleWebhook(request, environment, correlationId);
          logOperationalEvent({
            correlationId,
            category: "billing",
            operation: "stripe_webhook_processed",
            metadata: {
              eventType: result.orphaned
                ? "orphaned_customer"
                : result.duplicate
                  ? "duplicate"
                  : "completed",
              environment,
            },
          });
          return Response.json(
            { received: true, duplicate: result.duplicate, correlationId },
            {
              headers: {
                ...correlationHeaders(correlationId),
                "Cache-Control": "no-store",
              },
            },
          );
        } catch (error) {
          const verificationFailure = error instanceof StripeWebhookVerificationError;
          const retryableFailure =
            error instanceof WebhookProcessingError ? error.status >= 500 : !verificationFailure;
          logOperationalEvent({
            correlationId,
            category: "billing",
            operation: retryableFailure
              ? "stripe_webhook_retry_required"
              : "stripe_webhook_rejected",
            metadata: { environment },
          });
          return Response.json(
            {
              error: retryableFailure ? "webhook_retry_required" : "webhook_rejected",
              correlationId,
            },
            {
              status: retryableFailure ? 503 : 400,
              headers: {
                ...correlationHeaders(correlationId),
                "Cache-Control": "no-store",
                ...(retryableFailure ? { "Retry-After": "5" } : {}),
              },
            },
          );
        }
      },
    },
  },
});
