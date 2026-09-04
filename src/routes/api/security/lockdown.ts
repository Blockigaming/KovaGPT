import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import {
  LOCKDOWN_CAPABILITIES,
  lockdownErrorResponse,
  readLockdownMode,
} from "@/lib/lockdown-policy.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";

function noStore(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/security/lockdown")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          return noStore({
            enabled: await readLockdownMode(auth.supabaseAdmin, auth.userId),
            blockedCapabilities: LOCKDOWN_CAPABILITIES,
          });
        } catch (error) {
          return lockdownErrorResponse(error) ?? noStore({ error: "Lockdown Mode failed." }, 500);
        }
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let value: unknown;
        try {
          value = await readBoundedJsonObject(request, 1024);
        } catch (error) {
          if (error instanceof BoundedJsonError) {
            return noStore({ error: error.code }, error.status);
          }
          return noStore({ error: "invalid_request_body" }, 400);
        }
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 1 ||
          typeof (value as { enabled?: unknown }).enabled !== "boolean"
        ) {
          return noStore({ error: "invalid_lockdown_mode" }, 400);
        }
        const enabled = (value as { enabled: boolean }).enabled;
        const { data, error } = await auth.supabaseUser.rpc(
          "set_lockdown_mode" as never,
          {
            p_enabled: enabled,
          } as never,
        );
        if (error || !data || typeof data !== "object" || Array.isArray(data)) {
          return noStore({ error: "lockdown_update_failed" }, 503);
        }
        const result = data as { enabled?: unknown; updated_at?: unknown };
        if (result.enabled !== enabled || typeof result.updated_at !== "string") {
          return noStore({ error: "lockdown_update_unverified" }, 503);
        }
        return noStore({
          enabled,
          blockedCapabilities: LOCKDOWN_CAPABILITIES,
          updatedAt: result.updated_at,
        });
      },
    },
  },
});
