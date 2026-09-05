import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runReceiptMaintenanceBatch } from "@/lib/receipt-maintenance.server";

export const Route = createFileRoute("/api/internal/receipt-maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        // Dedicated opt-in: deployment alone does not authorize a cron secret
        // to start deleting receipts or activate a new background workload.
        const expected = runtimeEnv("RECEIPT_MAINTENANCE_SECRET");
        if (!expected) {
          return Response.json(
            { ok: false, error: "receipt_maintenance_not_configured" },
            { status: 503, headers },
          );
        }
        const supplied = /^Bearer\s+(.+)$/iu
          .exec(request.headers.get("authorization")?.trim() ?? "")?.[1]
          ?.trim();
        if (!supplied || !timingSafeEqualText(supplied, expected)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
        }
        // The caller cannot change the cutoff, batch size, or RPC selection.
        if (request.body !== null || new URL(request.url).search) {
          void request.body?.cancel().catch(() => undefined);
          return Response.json(
            { ok: false, error: "receipt_maintenance_arguments_not_supported" },
            { status: 400, headers },
          );
        }
        try {
          return Response.json({ ok: true, ...(await runReceiptMaintenanceBatch()) }, { headers });
        } catch {
          // No database error, principal identifier, receipt or secret is logged.
          return Response.json(
            { ok: false, error: "receipt_maintenance_failed" },
            { status: 503, headers },
          );
        }
      },
    },
  },
});
