import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/finances/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // A deployed edge/WAF must verify Plaid-Verification JWT before forwarding. Fail closed otherwise.
        if (
          request.headers.get("x-kova-webhook-verified") !==
          process.env.FINANCE_WEBHOOK_VERIFICATION_TOKEN
        )
          return Response.json({ error: "invalid_webhook_signature" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as {
          webhook_type?: string;
          webhook_code?: string;
          item_id?: string;
        } | null;
        if (!body?.webhook_type || !body.webhook_code || !body.item_id)
          return Response.json({ error: "invalid_webhook" }, { status: 400 });
        // Item IDs are deliberately not logged. A sync worker resolves the encrypted item reference.
        return Response.json({ accepted: true }, { status: 202 });
      },
    },
  },
});
