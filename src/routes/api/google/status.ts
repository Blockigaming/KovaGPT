import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { getGoogleConnectionHealth } from "@/lib/google-oauth.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { safeConnectorError } from "@/lib/connectors.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

export const Route = createFileRoute("/api/google/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "connector_read",
        );
        if (lockdown) return lockdown;
        const limited = await enforceGoogleRateLimit(auth.userId, "status", 30);
        if (limited) return limited;
        try {
          return Response.json(await getGoogleConnectionHealth(auth.userId));
        } catch (error) {
          console.error("[google status]", safeConnectorError(error));
          return Response.json(
            {
              connected: false,
              state: "temporarily_unavailable",
              scopes: [],
              has: {
                gmail: false,
                gmailWrite: false,
                calendar: false,
                calendarWrite: false,
                drive: false,
              },
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
