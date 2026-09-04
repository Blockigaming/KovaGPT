import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "@/lib/administrator.server";
import { runtimeReadiness } from "@/lib/readiness.server";
import { correlationHeaders, correlationId as resolveCorrelationId } from "@/lib/correlation";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

export const Route = createFileRoute("/api/admin/diagnostics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
        const authorization = await requireAdministrator(request, correlationId);
        if ("response" in authorization) {
          return Response.json(
            {
              error:
                authorization.response.status === 401 ? "unauthorized" : "diagnostics_unavailable",
              correlationId,
            },
            {
              status: authorization.response.status,
              headers: {
                "Cache-Control": "no-store",
                "X-Correlation-Id": correlationId,
              },
            },
          );
        }
        const limit = await consumeApplicationRateLimit({
          identity: `user:${authorization.caller.userId}`,
          action: "admin_diagnostics",
          limit: 12,
          windowSeconds: 60,
        });
        if (!limit.allowed)
          return Response.json(
            {
              error: limit.status === "limited" ? "rate_limited" : "diagnostics_unavailable",
              correlationId,
            },
            {
              status: limit.status === "limited" ? 429 : 503,
              headers: {
                ...correlationHeaders(correlationId),
                "Retry-After": String(limit.retryAfter),
              },
            },
          );
        const readiness = await runtimeReadiness();
        return Response.json(
          {
            correlationId,
            version: process.env.KOVA_BUILD_COMMIT?.slice(0, 40) ?? "unknown",
            ...readiness,
          },
          { headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
        );
      },
    },
  },
});
