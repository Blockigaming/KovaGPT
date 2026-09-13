import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runWebPushBatch } from "@/lib/pwa/push.server";
export const Route = createFileRoute("/api/internal/web-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = runtimeEnv("WEB_PUSH_WORKER_SECRET"),
          headers = { "Cache-Control": "no-store" };
        if (!secret)
          return Response.json({ error: "push_not_configured" }, { status: 503, headers });
        const supplied = /^Bearer\s+(.+)$/iu
          .exec(request.headers.get("authorization")?.trim() ?? "")?.[1]
          ?.trim();
        if (!supplied || !timingSafeEqualText(supplied, secret))
          return Response.json({ error: "unauthorized" }, { status: 401, headers });
        if (request.body !== null || new URL(request.url).search) {
          void request.body?.cancel().catch(() => {});
          return Response.json({ error: "arguments_not_supported" }, { status: 400, headers });
        }
        try {
          return Response.json(
            {
              ok: true,
              ...(await runWebPushBatch(
                AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
              )),
            },
            { headers },
          );
        } catch {
          return Response.json({ error: "push_worker_unavailable" }, { status: 503, headers });
        }
      },
    },
  },
});
