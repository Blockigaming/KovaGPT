import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runAccountExportBatch } from "@/lib/account-export.server";

function configuredSecret(): string | null {
  return runtimeEnv("ACCOUNT_EXPORT_WORKER_SECRET") || runtimeEnv("CRON_SECRET") || null;
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/iu.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1]?.trim() || null;
}

export const Route = createFileRoute("/api/internal/account-exports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = configuredSecret();
        const supplied = bearerToken(request);
        if (!expected) {
          return Response.json(
            { ok: false, error: "account_export_worker_not_configured" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (!supplied || !timingSafeEqualText(supplied, expected)) {
          return Response.json(
            { ok: false, error: "unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        }
        try {
          const result = await runAccountExportBatch({ limit: 2 });
          return Response.json(
            { ok: true, ...result },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          console.error("[account-export] worker batch failed");
          return Response.json(
            { ok: false, error: "account_export_worker_failed" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
