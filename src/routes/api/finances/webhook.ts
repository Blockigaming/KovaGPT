import { createFileRoute } from "@tanstack/react-router";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requestPlaid } from "@/finances/plaid-request.server.mjs";
import { createPlaidWebhookVerifier } from "@/finances/plaid-webhook.server.mjs";
import { persistFinanceWebhook } from "@/finances/plaid.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionDomainDatabase } from "@/integrations/connection-domain.types";

const verifyWebhook = createPlaidWebhookVerifier(requestPlaid);

export const Route = createFileRoute("/api/finances/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: string;
        try {
          raw = await readUtf8BodyBounded(request, 256 * 1024);
        } catch (error) {
          if (error instanceof BodyReadError) {
            const code = error.status === 413 ? "webhook_too_large" : "invalid_webhook_body";
            return Response.json({ error: code }, { status: error.status });
          }
          return Response.json({ error: "invalid_webhook_body" }, { status: 400 });
        }
        try {
          const event = await verifyWebhook(raw, request.headers.get("plaid-verification"));
          const result = await persistFinanceWebhook(
            supabaseAdmin as unknown as SupabaseClient<ConnectionDomainDatabase>,
            event,
          );
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const status =
            code === "invalid_webhook_signature" ? 401 : code === "invalid_webhook" ? 400 : 503;
          return Response.json(
            { error: status === 503 ? "finance_webhook_unavailable" : code },
            {
              status,
              headers: {
                "Cache-Control": "no-store",
                ...(status === 503 ? { "Retry-After": "30" } : {}),
              },
            },
          );
        }
      },
    },
  },
});
