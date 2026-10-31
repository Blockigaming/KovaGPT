import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { readHealthAccount } from "@/health/health-accounts.server";
import { readUtf8BodyBounded, BodyReadError } from "@/lib/endpoint-reliability.mjs";

export const Route = createFileRoute("/api/health-data/read")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const headers = { "Cache-Control": "no-store" };
        try {
          const body = JSON.parse(await readUtf8BodyBounded(request, 4096)) as {
            accountId?: string;
          };
          if (
            !body ||
            typeof body.accountId !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(body.accountId)
          )
            return Response.json({ error: "invalid_health_account" }, { status: 400, headers });
          return Response.json(await readHealthAccount(auth, body.accountId), { headers });
        } catch (error) {
          if (error instanceof BodyReadError)
            return Response.json(
              { error: "invalid_health_request" },
              { status: error.status, headers },
            );
          if (error instanceof SyntaxError)
            return Response.json({ error: "invalid_health_request" }, { status: 400, headers });
          const raw = error instanceof Error ? error.message : "";
          const codes: Record<string, number> = {
            health_not_configured: 503,
            health_account_unavailable: 404,
            health_reconnect_required: 401,
            health_session_expired: 401,
            health_access_denied: 403,
            health_permission_required: 403,
            health_binding_changed: 409,
            health_rate_limited: 429,
            lockdown_blocked_connector_read: 403,
          };
          return Response.json(
            { error: codes[raw] ? raw : "health_read_unavailable" },
            { status: codes[raw] ?? 503, headers },
          );
        }
      },
    },
  },
});
