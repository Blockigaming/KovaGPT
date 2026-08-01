import { createFileRoute } from "@tanstack/react-router";
import { financeQueueUnavailableResponse } from "@/lib/endpoint-reliability.mjs";
import { timingSafeEqualText } from "@/lib/http-security.server";

export const Route = createFileRoute("/api/finances/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // A deployed edge/WAF must verify Plaid-Verification JWT before forwarding. Fail closed otherwise.
        const verificationToken = process.env.FINANCE_WEBHOOK_VERIFICATION_TOKEN;
        if (!verificationToken) {
          return Response.json({ error: "webhook_verification_unavailable" }, { status: 503 });
        }
        const suppliedToken = request.headers.get("x-kova-webhook-verified") ?? "";
        if (!timingSafeEqualText(suppliedToken, verificationToken)) {
          return Response.json({ error: "invalid_webhook_signature" }, { status: 401 });
        }

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(contentLength) || contentLength > 256 * 1024) {
          return Response.json({ error: "webhook_too_large" }, { status: 413 });
        }
        const raw = await request.text();
        if (raw.length > 256 * 1024) {
          return Response.json({ error: "webhook_too_large" }, { status: 413 });
        }
        const body = (await Promise.resolve()
          .then(() => JSON.parse(raw))
          .catch(() => null)) as {
          webhook_type?: string;
          webhook_code?: string;
          item_id?: string;
        } | null;
        if (!body?.webhook_type || !body.webhook_code || !body.item_id) {
          return Response.json({ error: "invalid_webhook" }, { status: 400 });
        }

        // There is currently no durable finance-event queue/table in the schema.
        // A 2xx would tell the provider to stop retrying and silently lose this
        // verified event. Return a truthful retryable failure until persistence is wired.
        // Item IDs remain deliberately unlogged.
        return financeQueueUnavailableResponse();
      },
    },
  },
});
