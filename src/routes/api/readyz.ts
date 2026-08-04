import { createFileRoute } from "@tanstack/react-router";
import { runtimeReadiness } from "@/lib/readiness.server";
import { runtimeEnv } from "@/lib/runtime-env.server";

/**
 * Public probes get a minimal ok/not-ok status only. The detailed capability map
 * (which integrations are configured, schema contract state) is internal
 * reconnaissance material and requires a monitoring token.
 */
function authorizedMonitor(request: Request): boolean {
  const provided = request.headers.get("x-readiness-token")?.trim();
  if (!provided) return false;
  const expected =
    runtimeEnv("KOVA_READINESS_TOKEN") ||
    runtimeEnv("CRON_SECRET") ||
    runtimeEnv("SCHEDULED_TASK_SECRET");
  if (!expected || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1)
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return mismatch === 0;
}

export const Route = createFileRoute("/api/readyz")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const correlationId =
          request.headers.get("x-correlation-id")?.slice(0, 64) || crypto.randomUUID();
        const report = await runtimeReadiness();
        const detailed = authorizedMonitor(request);
        const body = detailed
          ? { ...report, correlationId }
          : {
              status: report.status,
              checkedAt: report.checkedAt,
              capabilities: {},
              correlationId,
            };
        return Response.json(body, {
          status: report.status === "unavailable" ? 503 : 200,
          headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId },
        });
      },
    },
  },
});
