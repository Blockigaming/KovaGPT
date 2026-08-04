import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "@/lib/administrator.server";
import { runtimeReadiness } from "@/lib/readiness.server";
import { correlationHeaders, correlationId as resolveCorrelationId } from "@/lib/correlation";

async function consumeLimit(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const identity = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { allowed: false, retryAfter: 60 };
  try {
    const response = await fetch(`${url}/rest/v1/rpc/consume_diagnostic_rate_limit`, {
      method: "POST",
      signal: AbortSignal.timeout(1200),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_identity_hash: identity,
        p_action: "admin_diagnostics",
        p_limit: 12,
        p_window_seconds: 60,
      }),
    });
    if (!response.ok) return { allowed: false, retryAfter: 60 };
    const result = (await response.json()) as Array<{ allowed?: boolean; retry_after?: number }>;
    return {
      allowed: result[0]?.allowed === true,
      retryAfter: Math.max(1, result[0]?.retry_after ?? 60),
    };
  } catch {
    return { allowed: false, retryAfter: 60 };
  }
}

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
        const limit = await consumeLimit(authorization.caller.userId);
        if (!limit.allowed)
          return Response.json(
            { error: "rate_limited", correlationId },
            {
              status: 429,
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
