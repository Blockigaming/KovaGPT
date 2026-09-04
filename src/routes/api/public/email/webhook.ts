import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BodyReadError,
  readUtf8BodyBounded,
} from "@/lib/endpoint-reliability.mjs";
import {
  parseResendWebhookEvent,
  ResendWebhookError,
  sha256Text,
  verifyResendWebhookSignature,
} from "@/lib/resend-webhook.mjs";

const MAX_WEBHOOK_BYTES = 256 * 1024;

function noStore(value: unknown, status = 200, retryAfter?: string): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const Route = createFileRoute("/api/public/email/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
        ) {
          return noStore({ error: "unsupported_media_type" }, 415);
        }

        let raw: string;
        try {
          raw = await readUtf8BodyBounded(request, MAX_WEBHOOK_BYTES);
        } catch (error) {
          if (error instanceof BodyReadError) {
            return noStore(
              {
                error:
                  error.status === 413
                    ? "resend_webhook_too_large"
                    : "invalid_resend_webhook_body",
              },
              error.status,
            );
          }
          return noStore({ error: "invalid_resend_webhook_body" }, 400);
        }

        const deliveryId = request.headers.get("svix-id") ?? "";
        try {
          await verifyResendWebhookSignature({
            secret: process.env.RESEND_WEBHOOK_SECRET,
            deliveryId,
            timestamp: request.headers.get("svix-timestamp") ?? "",
            signature: request.headers.get("svix-signature") ?? "",
            body: raw,
          });
        } catch (error) {
          const status = error instanceof ResendWebhookError ? error.status : 503;
          const code =
            error instanceof ResendWebhookError
              ? error.code
              : "resend_webhook_verification_unavailable";
          return noStore({ error: code }, status, status === 503 ? "30" : undefined);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return noStore({ error: "invalid_resend_webhook_json" }, 400);
        }

        let event;
        try {
          event = parseResendWebhookEvent(parsed);
        } catch (error) {
          const status = error instanceof ResendWebhookError ? error.status : 400;
          const code =
            error instanceof ResendWebhookError ? error.code : "invalid_resend_webhook_payload";
          return noStore({ error: code }, status);
        }

        const payloadSha256 = await sha256Text(raw);
        const { data, error } = await supabaseAdmin.rpc(
          "process_resend_webhook_event" as never,
          {
            p_event_id: deliveryId,
            p_event_type: event.type,
            p_provider_message_id: event.providerMessageId,
            p_occurred_at: event.occurredAt,
            p_payload_sha256: payloadSha256,
          } as never,
        );
        if (error) {
          console.error("Resend webhook persistence failed", {
            event_type: event.type,
            error_code: "resend_webhook_database_unavailable",
          });
          return noStore({ error: "resend_webhook_database_unavailable" }, 503, "30");
        }

        const result = record(data);
        if (
          !result ||
          typeof result.duplicate !== "boolean" ||
          typeof result.applied !== "boolean" ||
          typeof result.retryable !== "boolean" ||
          typeof result.conflict !== "boolean"
        ) {
          return noStore({ error: "resend_webhook_result_invalid" }, 503, "30");
        }
        if (result.conflict) {
          return noStore({ error: "resend_webhook_replay_conflict" }, 409);
        }
        if (result.retryable) {
          return noStore(
            {
              error:
                typeof result.code === "string"
                  ? result.code
                  : "resend_webhook_reconciliation_pending",
            },
            503,
            "30",
          );
        }
        if (typeof result.code === "string" && !result.applied) {
          return noStore({ error: result.code }, 422);
        }

        return noStore({
          accepted: true,
          duplicate: result.duplicate,
          applied: result.applied,
        });
      },
    },
  },
});
