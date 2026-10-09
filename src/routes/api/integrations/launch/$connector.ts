import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import {
  assertLaunchCertified,
  ConnectorError,
  isLaunchConnector,
} from "@/integrations/launch-contracts.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { launchConnectorService } from "@/integrations/launch-service.server";
import { readOauthCookie, serializeOauthCookie } from "@/lib/oauth-security.server";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const cookieName = (id: string) => `__Host-kova_launch_${id.replace(/-/g, "_")}`;
export const Route = createFileRoute("/api/integrations/launch/$connector")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const connector = params.connector;
        if (!isLaunchConnector(connector)) return json({ error: "unsupported_connector" }, 404);
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          const body = await readBoundedJsonObject(request, 32_768, request.signal);
          const service = launchConnectorService(request);
          if (body.action === "disconnect") {
            if (!uuid(body.accountId)) return json({ error: "invalid_account_id" }, 400);
            return json(
              await service.disconnect({
                ownerId: auth.userId,
                connector,
                accountId: body.accountId,
              }),
            );
          }
          assertLaunchCertified(connector);
          const rate = await consumeApplicationRateLimit({
            identity: `user:${auth.userId}`,
            action: `launch_connector_${connector}`,
            limit: 30,
            windowSeconds: 60,
          });
          if (!rate.allowed)
            return json(
              {
                error:
                  rate.status === "limited"
                    ? "connector_rate_limited"
                    : "connector_rate_limit_unavailable",
              },
              rate.status === "limited" ? 429 : 503,
            );
          const sessionId = auth.claims?.session_id;
          if (auth.authProvider !== "kova" || typeof sessionId !== "string")
            return json({ error: "owned_session_required" }, 401);
          const principal = { ownerId: auth.userId, sessionId, connector };
          if (body.action === "connect") {
            const browserNonce = crypto.randomUUID();
            const result = await service.begin({
              ...principal,
              browserNonce,
              origin: new URL(request.url).origin,
              returnPath: typeof body.returnPath === "string" ? body.returnPath : undefined,
            });
            return json(result, 200, {
              "Set-Cookie": serializeOauthCookie(cookieName(connector), browserNonce),
            });
          }
          if (body.action !== "read" || !uuid(body.accountId) || typeof body.operation !== "string")
            return json({ error: "invalid_connector_request" }, 400);
          if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== "string")
            return json({ error: "invalid_cursor" }, 400);
          if (
            body.args !== undefined &&
            (!body.args || typeof body.args !== "object" || Array.isArray(body.args))
          )
            return json({ error: "invalid_arguments" }, 400);
          return json(
            await service.execute({
              ...principal,
              accountId: body.accountId,
              operation: body.operation,
              args: body.args as Record<string, unknown> | undefined,
              cursor: body.cursor as string | null | undefined,
            }),
          );
        } catch (error) {
          return json(
            { error: error instanceof ConnectorError ? error.code : "connector_request_failed" },
            error instanceof ConnectorError ? error.status : 400,
          );
        }
      },
      GET: async ({ request, params }) => {
        const connector = params.connector;
        if (!isLaunchConnector(connector)) return json({ error: "unsupported_connector" }, 404);
        const url = new URL(request.url),
          target = new URL("/apps", url.origin);
        try {
          const state = url.searchParams.get("state"),
            code = url.searchParams.get("code"),
            browserNonce = readOauthCookie(request, cookieName(connector));
          if (url.searchParams.has("error") || !state || !code || !browserNonce)
            throw new ConnectorError("oauth_denied_or_invalid", 400);
          const result = await launchConnectorService(request).complete({
            connector,
            state,
            code,
            browserNonce,
            origin: url.origin,
          });
          target.pathname = new URL(result.returnPath, url.origin).pathname;
          target.searchParams.set("integration_connected", connector);
        } catch {
          target.searchParams.set("integration_error", "connection_not_completed");
        }
        return new Response(null, {
          status: 303,
          headers: {
            Location: target.toString(),
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Set-Cookie": `${cookieName(connector)}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
          },
        });
      },
    },
  },
});
