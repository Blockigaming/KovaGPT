import { createFileRoute } from "@tanstack/react-router";
import { authenticateEmailWorkerRequest } from "@/lib/kova-email-worker-auth.server.mjs";
import {
  productionEmailWorkerConfiguration,
  runProductionEmailWorker,
} from "@/lib/kova-email-worker.server.mjs";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";

export const Route = createFileRoute("/api/internal/email-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        let config;
        try {
          config = productionEmailWorkerConfiguration();
        } catch {
          return Response.json(
            { ok: false, error: "email_worker_not_configured" },
            { status: 503, headers },
          );
        }
        let run;
        try {
          if (new URL(request.url).origin !== config.publicOrigin) throw new Error("origin");
          run = authenticateEmailWorkerRequest(request);
          // The signed body is exactly {}. No account, recipient, event ID, batch
          // size, deadline or arbitrary payload can cross this service boundary.
          if ((await readUtf8BodyBounded(request, 2)) !== "{}") throw new Error("body");
        } catch {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
        }
        try {
          return Response.json(
            { ok: true, ...(await runProductionEmailWorker(run, config)) },
            { headers },
          );
        } catch {
          return Response.json(
            { ok: false, error: "email_worker_pending" },
            { status: 503, headers },
          );
        }
      },
    },
  },
});
