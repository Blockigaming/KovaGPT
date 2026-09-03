import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createStripeClient, type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { logOperationalEvent } from "@/lib/structured-log.server";
import { correlationHeaders, correlationId as resolveCorrelationId } from "@/lib/correlation";
import { billingOutcome, processStripeEvent } from "@/lib/webhook-reliability.mjs";

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
    lookup_key?: string | null;
    metadata?: { kova_plan?: string };
    id?: string;
  } | null;
};

class StripeWebhookVerificationError extends Error {
  constructor(cause: unknown) {
    super("stripe_webhook_verification_failed", { cause });
    this.name = "StripeWebhookVerificationError";
  }
}

export { billingOutcome };

export function normalizeStripeEnvironment(value: string | null): StripeEnv | null {
  return value === "sandbox" || value === "live" ? value : null;
}

function priceIdFrom(item: StripeLineItemLike | undefined): string | undefined {
  const candidates = [item?.price?.lookup_key, item?.price?.metadata?.kova_plan, item?.price?.id];
  for (const candidate of candidates) {
    const plan = resolveBillingPlan(candidate);
    if (plan) return plan.lookupKey;
  }
  return undefined;
}

export async function handleWebhook(
  req: Request,
  env: StripeEnv,
  correlationId: string = crypto.randomUUID(),
) {
  let event;
  try {
    event = await verifyWebhook(req, env);
  } catch (error) {
    throw new StripeWebhookVerificationError(error);
  }

  const result = await processStripeEvent({
    supabase: getSupabase(),
    event,
    environment: env,
    resolvePriceId: priceIdFrom,
    retrieveSubscription: async (subscriptionId) =>
      createStripeClient(env).subscriptions.retrieve(subscriptionId),
    correlationId,
  });

  logOperationalEvent({
    correlationId,
    category: "billing",
    operation: "stripe_webhook_processed",
    metadata: {
      eventType: event.type,
      environment: env,
      duplicate: result.duplicate,
      applied: result.applied,
    },
  });
  return result;
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
          return Response.json(
            {
              received: true,
              duplicate: result.duplicate,
              applied: result.applied,
              correlationId,
            },
            {
              headers: {
                ...correlationHeaders(correlationId),
                "Cache-Control": "no-store",
              },
            },
          );
        } catch (error) {
          const verificationFailure = error instanceof StripeWebhookVerificationError;
          logOperationalEvent({
            correlationId,
            category: "billing",
            operation: verificationFailure
              ? "stripe_webhook_rejected"
              : "stripe_webhook_processing_failed",
            metadata: { environment },
          });
          return Response.json(
            {
              error: verificationFailure ? "webhook_rejected" : "webhook_processing_failed",
              correlationId,
            },
            {
              status: verificationFailure ? 400 : 503,
              headers: {
                ...correlationHeaders(correlationId),
                "Cache-Control": "no-store",
                ...(verificationFailure ? {} : { "Retry-After": "5" }),
              },
            },
          );
        }
      },
    },
  },
});
