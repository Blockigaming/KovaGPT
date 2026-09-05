import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runGoogleOAuthCleanup } from "@/lib/google-oauth.server";
export const Route = createFileRoute("/api/internal/google-oauth-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        const expected = runtimeEnv("GOOGLE_OAUTH_CLEANUP_SECRET");
        if (!expected)
          return Response.json({ error: "cleanup_not_configured" }, { status: 503, headers });
        const supplied = /^Bearer\s+(.+)$/iu
          .exec(request.headers.get("authorization")?.trim() ?? "")?.[1]
          ?.trim();
        if (!supplied || !timingSafeEqualText(supplied, expected))
          return Response.json({ error: "unauthorized" }, { status: 401, headers });
        if (request.body !== null || new URL(request.url).search) {
          void request.body?.cancel().catch(() => {});
          return Response.json({ error: "arguments_not_supported" }, { status: 400, headers });
        }
        try {
          return Response.json({ ok: true, ...(await runGoogleOAuthCleanup()) }, { headers });
        } catch {
          return Response.json({ error: "cleanup_unavailable" }, { status: 503, headers });
        }
      },
    },
  },
});
