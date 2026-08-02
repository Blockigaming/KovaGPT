import { createFileRoute } from "@tanstack/react-router";
import { runtimeReadiness } from "@/lib/readiness.server";

export const Route = createFileRoute("/api/readyz")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const correlationId =
          request.headers.get("x-correlation-id")?.slice(0, 64) || crypto.randomUUID();
        const report = await runtimeReadiness();
        return Response.json(
          { ...report, correlationId },
          {
            status: report.status === "unavailable" ? 503 : 200,
            headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId },
          },
        );
      },
    },
  },
});
