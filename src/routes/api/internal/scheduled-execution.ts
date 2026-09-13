import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runScheduledExecutionBatch } from "@/lib/scheduled-execution.server";

function configuredSecret(): string | null {
  return runtimeEnv("SCHEDULED_TASK_SECRET") || runtimeEnv("CRON_SECRET") || null;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

function authorize(request: Request): boolean {
  const expected = configuredSecret();
  const supplied = bearerToken(request);

  if (!expected || expected.length < 32 || !supplied) return false;

  return timingSafeEqualText(supplied, expected);
}

export const Route = createFileRoute("/api/internal/scheduled-execution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!configuredSecret()) {
          return Response.json(
            {
              ok: false,
              error: "scheduled_execution_not_configured",
            },
            {
              status: 503,
              headers: {
                "Cache-Control": "no-store",
              },
            },
          );
        }

        if (!authorize(request)) {
          return Response.json(
            {
              ok: false,
              error: "unauthorized",
            },
            {
              status: 401,
              headers: {
                "Cache-Control": "no-store",
              },
            },
          );
        }

        try {
          const result = await runScheduledExecutionBatch({
            limit: 1,
          });

          return Response.json(
            {
              ok: true,
              claimed: result.claimed,
              complete: result.complete,
              failed: result.failed,
            },
            {
              headers: {
                "Cache-Control": "no-store",
              },
            },
          );
        } catch (error) {
          console.error("[scheduled-execution] worker batch failed");

          return Response.json(
            {
              ok: false,
              error: "scheduled_execution_failed",
            },
            {
              status: 500,
              headers: {
                "Cache-Control": "no-store",
              },
            },
          );
        }
      },
    },
  },
});
