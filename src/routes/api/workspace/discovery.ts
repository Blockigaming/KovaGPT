import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { organizationAvailability } from "@/lib/organization-policy.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function guardRateLimit(userId: string, write: boolean): Promise<Response | null> {
  const result = await consumeApplicationRateLimit({
    identity: "user:" + userId,
    action: write ? "organization_mutation" : "organization_read",
    limit: write ? 10 : 60,
    windowSeconds: 60,
  });
  return result.allowed
    ? null
    : json({ error: result.status === "limited" ? "rate_limited" : "protection_unavailable" },
       result.status === "limited" ? 429 : 503);
}
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) =>
  PromiseLike<{data: unknown; error: {code?: string} | null}> };

export const Route = createFileRoute("/api/workspace/discovery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        if (!organizationAvailability(process.env).available) return json({workspaces: [], available: false});
        const blocked = await guardRateLimit(auth.userId, false);
        if (blocked) return blocked;
        const url = new URL(request.url);
        const view = url.searchParams.get("view");
        if ([...url.searchParams.keys()].some(key => !["view", "organizationId"].includes(key)) ||
          (view !== null && view !== "requests")) return json({ error: "invalid_query" }, 400);
        const admin = auth.supabaseAdmin as unknown as RpcClient;
        if (view === "requests") {
          const id = url.searchParams.get("organizationId");
          if (!id || !UUID.test(id)) return json({ error: "invalid_query" }, 400);
          const { data, error } = await admin.rpc("kova_workspace_join_inbox",
            { p_actor_user_id: auth.userId, p_organization_id: id });
          return error ? json({ error: "workspace_unavailable" }, error.code === "42501" ? 403 : 503)
            : json({ requests: data ?? [] });
        }
        if (url.searchParams.has("organizationId")) return json({ error: "invalid_query" }, 400);
        const { data, error } = await admin.rpc("kova_discover_organizations",
          { p_actor_user_id: auth.userId });
        return error ? json({ error: "workspace_unavailable" }, 503)
          : json({ workspaces: data ?? [] });
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        if (!organizationAvailability(process.env).available)
          return json({ error: "organization_administration_unavailable" }, 503);
        const blocked = await guardRateLimit(auth.userId, true);
        if (blocked) return blocked;
        if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json") return json({ error: "json_content_type_required" }, 415);
        let input: Record<string, unknown>;
        try {
          input = await readBoundedJsonObject(request, 512) as Record<string, unknown>;
        } catch { return json({ error: "invalid_input" }, 400); }
        if (!input || typeof input !== "object" || Array.isArray(input))
          return json({ error: "invalid_input" }, 400);
        const action = input.action;
        if (action !== "request" && action !== "decline") return json({error:"invalid_input"},400);
        const expected = action === "request" ? "action,organizationId" : "action,requestId";
        if (Object.keys(input).sort().join(",") !== expected) return json({error:"invalid_input"},400);
        const id = action === "request" ? input.organizationId : input.requestId;
        if (typeof id !== "string" || !UUID.test(id)) return json({error:"invalid_input"},400);
        const admin = auth.supabaseAdmin as unknown as RpcClient;
        const { data, error } = await admin.rpc(
          action === "request" ? "kova_request_organization_join" : "kova_decline_organization_join",
          action === "request" ? {p_actor_user_id: auth.userId,p_organization_id: id} :
            {p_actor_user_id: auth.userId,p_request_id: id});
        if (error) return json({ error: error.code === "42501" ? "permission_denied" : "workspace_unavailable" },
           error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 503);
        return json({ status: data });
      },
    },
  },
});
