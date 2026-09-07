import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "@/lib/administrator.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { kovaId } from "@/lib/custom-kovas-policy.mjs";
import { kovaRpc, kovaError } from "@/lib/custom-kovas.server";
export const Route = createFileRoute("/api/admin/kovas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAdministrator(request);
        if ("response" in auth) return auth.response;
        try {
          const url = new URL(request.url);
          if ([...url.searchParams.keys()].some((k) => k !== "id"))
            throw Object.assign(Error("invalid"), { status: 400 });
          const id = url.searchParams.get("id");
          return Response.json(
            await kovaRpc(
              auth.caller.supabaseAdmin,
              id ? "read_custom_kova_moderation" : "read_custom_kova_reports",
              id
                ? { p_actor: auth.caller.userId, p_id: kovaId(id) }
                : { p_actor: auth.caller.userId },
              request.signal,
            ),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return kovaError(e);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return Response.json({ error: "cross_site_request_blocked" }, { status: 403 });
        const auth = await requireAdministrator(request);
        if ("response" in auth) return auth.response;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.caller.userId}`,
          action: "custom_kova_moderation",
          limit: 30,
          windowSeconds: 60,
        });
        if (!rate.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });
        try {
          const data = await readBoundedJsonObject(request, 4096);
          if (
            Object.keys(data).some(
              (k) => !["id", "revision", "action", "reason", "reportId"].includes(k),
            ) ||
            !Number.isSafeInteger(data.revision) ||
            Number(data.revision) < 1 ||
            !["block", "restore", "review"].includes(String(data.action)) ||
            typeof data.reason !== "string" ||
            !data.reason.trim() ||
            data.reason.length > 2000
          )
            throw Object.assign(Error("invalid"), { status: 400 });
          return Response.json(
            await kovaRpc(
              auth.caller.supabaseAdmin,
              "moderate_custom_kova",
              {
                p_actor: auth.caller.userId,
                p_id: kovaId(data.id),
                p_revision: data.revision,
                p_action: data.action,
                p_reason: data.reason.trim(),
                p_report: data.action === "review" ? kovaId(data.reportId) : null,
              },
              request.signal,
            ),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          if (e instanceof BoundedJsonError)
            return Response.json({ error: e.code }, { status: e.status });
          return kovaError(e);
        }
      },
    },
  },
});
