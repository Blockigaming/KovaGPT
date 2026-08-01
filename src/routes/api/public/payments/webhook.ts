import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { resolveBillingPlan } from "@/lib/billing-plans";
import { processStripeEvent, WebhookProcessingError } from "@/lib/webhook-reliability.mjs";
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
    product?: string | { id?: string };
  };
  current_period_start?: number;
  current_period_end?: number;
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

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "live") {
          console.error("Webhook invalid env:", rawEnv);
          return Response.json({ error: "invalid_environment" }, { status: 400 });
        }

        let event;
        try {
          event = await verifyWebhook(request, rawEnv);
        } catch (error) {
          console.error("Webhook verification error:", error);
          return Response.json({ error: "invalid_webhook" }, { status: 400 });
        }

        try {
          const result = await processStripeEvent({
            supabase: getSupabase(),
            event,
            environment: rawEnv,
            resolvePriceId: priceIdFrom,
          });
          return Response.json({ received: true, duplicate: result.duplicate });
        } catch (error) {
          console.error("Webhook processing error:", error);
          const status = error instanceof WebhookProcessingError ? error.status : 500;
          const code =
            error instanceof WebhookProcessingError ? error.code : "webhook_processing_failed";
          return Response.json({ error: code }, { status });
        }
      },
    },
  },
});
