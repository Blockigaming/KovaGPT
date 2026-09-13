import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser, getCallerTier } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { KOVA_LIMITS, kovaId, normalizeKovaConfig } from "@/lib/custom-kovas-policy.mjs";
import { kovaRpc, kovaError, hashKovaToken } from "@/lib/custom-kovas.server";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function invalid(): never {
  throw Object.assign(Error("custom_kova_invalid"), { status: 400 });
}
export const Route = createFileRoute("/api/kovas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "custom_kova_read",
          limit: 120,
          windowSeconds: 60,
        });
        if (!rate.allowed) return json({ error: "custom_kova_rate_limited" }, 429);
        try {
          const url = new URL(request.url),
            scope = url.searchParams.get("scope") ?? "owned";
          if (
            !["owned", "read", "versions", "version", "knowledge"].includes(scope) ||
            [...url.searchParams.keys()].some(
              (v) => !["scope", "id", "after", "versionId"].includes(v),
            )
          )
            invalid();
          return json(
            await kovaRpc(
              auth.supabaseAdmin,
              "read_custom_kovas",
              {
                p_actor: auth.userId,
                p_scope: scope,
                p_id: url.searchParams.get("id") ? kovaId(url.searchParams.get("id")) : null,
                p_after: url.searchParams.get("after")
                  ? kovaId(url.searchParams.get("after"))
                  : null,
                p_version: url.searchParams.get("versionId")
                  ? kovaId(url.searchParams.get("versionId"))
                  : null,
              },
              request.signal,
            ),
          );
        } catch (e) {
          return kovaError(e);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "custom_kova_write",
          limit: 40,
          windowSeconds: 60,
        });
        if (!rate.allowed) return json({ error: "custom_kova_rate_limited" }, 429);
        try {
          const input = await readBoundedJsonObject(request, KOVA_LIMITS.bodyBytes);
          if (
            Object.keys(input).some(
              (k) =>
                !["id", "mutationId", "revision", "action", "payload", "requestedAt"].includes(k),
            ) ||
            typeof input.action !== "string" ||
            ![
              "create",
              "save",
              "restore",
              "deleteVersion",
              "publish",
              "unpublish",
              "delete",
              "fork",
              "claimLink",
              "report",
            ].includes(input.action) ||
            !Number.isSafeInteger(input.revision) ||
            Number(input.revision) < 0
          )
            invalid();
          if (
            typeof input.requestedAt !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.requestedAt) ||
            !Number.isFinite(Date.parse(input.requestedAt)) ||
            new Date(input.requestedAt).toISOString() !== input.requestedAt
          )
            invalid();
          const payload = input.payload as Record<string, unknown>;
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid();
          let prepared: Record<string, unknown> = {};
          const action = input.action;
          if (["create", "save"].includes(action)) {
            if (Object.keys(payload).some((k) => k !== "config")) invalid();
            prepared = { config: normalizeKovaConfig(payload.config) };
          } else if (["restore", "deleteVersion"].includes(action)) {
            if (Object.keys(payload).some((k) => k !== "versionId")) invalid();
            prepared = { versionId: kovaId(payload.versionId) };
          } else if (action === "publish") {
            if (
              Object.keys(payload).some(
                (k) => !["visibility", "versionId", "consent", "token"].includes(k),
              ) ||
              !["link", "public"].includes(String(payload.visibility))
            )
              invalid();
            prepared = {
              visibility: payload.visibility,
              versionId: kovaId(payload.versionId),
              consent: kovaId(payload.consent),
              ...(payload.visibility === "link"
                ? { linkHash: await hashKovaToken(payload.token) }
                : {}),
            };
          } else if (action === "claimLink") {
            if (Object.keys(payload).some((k) => k !== "token")) invalid();
            prepared = { linkHash: await hashKovaToken(payload.token) };
          } else if (action === "fork") {
            if (Object.keys(payload).some((k) => k !== "consent")) invalid();
            prepared = { consent: kovaId(payload.consent) };
          } else if (action === "report") {
            if (
              Object.keys(payload).some((k) => k !== "reason") ||
              typeof payload.reason !== "string" ||
              !payload.reason.trim() ||
              payload.reason.length > 2000
            )
              invalid();
            prepared = { reason: payload.reason.trim() };
          } else if (Object.keys(payload).length) invalid();
          const tier = await getCallerTier(auth);
          return json(
            await kovaRpc(
              auth.supabaseAdmin,
              "mutate_custom_kova",
              {
                p_actor: auth.userId,
                p_id: input.id === null ? null : kovaId(input.id),
                p_mutation: kovaId(input.mutationId),
                p_revision: input.revision,
                p_action: action,
                p_payload: prepared,
                p_storage_limit: STORAGE_LIMITS_BYTES[tier],
                p_requested_at: input.requestedAt,
              },
              request.signal,
            ),
          );
        } catch (e) {
          if (e instanceof BoundedJsonError) return json({ error: e.code }, e.status);
          return kovaError(e);
        }
      },
    },
  },
});
