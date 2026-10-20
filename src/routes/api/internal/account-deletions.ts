import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runAccountDeletionBatch } from "@/lib/account-deletion-worker.server";

export const Route = createFileRoute("/api/internal/account-deletions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Dedicated custody: never fall back to an exposed/shared scheduler key.
        const expected = runtimeEnv("ACCOUNT_DELETION_WORKER_SECRET");
        if (!expected || new TextEncoder().encode(expected).length < 32)
          return Response.json(
            { error: "account_deletion_worker_not_configured" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        const supplied = /^Bearer ([^\s]+)$/u.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!supplied || !timingSafeEqualText(supplied, expected))
          return Response.json(
            { error: "unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        // No caller-supplied account, deadline, batch size or attempt identity.
        if (
          request.body !== null ||
          (request.headers.get("content-length") && request.headers.get("content-length") !== "0")
        )
          return Response.json(
            { error: "worker_body_not_allowed" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        try {
          return Response.json(
            { ok: true, ...(await runAccountDeletionBatch()) },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { ok: false, error: "account_deletion_worker_pending" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
