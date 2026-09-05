import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { recoverDeveloperBilling } from "@/lib/pricing/developer-billing.server";
export const Route = createFileRoute("/api/internal/developer-billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = runtimeEnv("DEVELOPER_BILLING_WORKER_SECRET");
        if (
          !secret ||
          !timingSafeEqualText(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
        )
          return Response.json(
            { error: "unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        if (new URL(request.url).search || request.body)
          return Response.json(
            { error: "body_not_allowed" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        try {
          return Response.json(
            { recovered: await recoverDeveloperBilling() },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { error: "billing_maintenance_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
