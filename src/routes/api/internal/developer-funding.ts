import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { processDeveloperFunding } from "@/lib/pricing/developer-funding.server";
export const Route = createFileRoute("/api/internal/developer-funding")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = runtimeEnv("DEVELOPER_FUNDING_WORKER_SECRET");
        if (
          !secret ||
          !timingSafeEqualText(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
        )
          return Response.json({ error: "unauthorized" }, { status: 401 });
        if (request.body || new URL(request.url).search)
          return Response.json({ error: "body_not_allowed" }, { status: 400 });
        try {
          let reconciled = 0;
          for (let i = 0; i < 5; i++) {
            if (await processDeveloperFunding()) reconciled++;
            else break;
          }
          return Response.json({ reconciled }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json(
            { error: "funding_maintenance_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
