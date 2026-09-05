import { createFileRoute } from "@tanstack/react-router";
import {
  requireVerifiedUser,
  getCallerTier,
  assertNotBanned,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { isCrossSiteMutation, parseBearerToken } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
import {
  inspectSiteFiles,
  sha256,
  siteOrigin,
  siteSlug,
  siteUuid,
  SITE_LIMITS,
  SiteInputError,
} from "@/lib/sites-policy.mjs";
import { readySiteHosting } from "@/lib/sites-hosting.server";
import { parseAgentStorageReference } from "@/lib/project-file-storage-policy.mjs";

type Result = { data: unknown; error: { code?: string } | null };
type Admin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<Result> & { abortSignal(signal: AbortSignal): PromiseLike<Result> };
};
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
async function rpc(client: Admin, name: string, args: Record<string, unknown>) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await client.rpc(name, args).abortSignal(controller.signal);
    if (result.error)
      throw Object.assign(new Error("site_operation_failed"), { databaseCode: result.error.code });
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}
async function currentSiteSession(auth: AuthedCaller, request: Request): Promise<string> {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) throw Object.assign(new Error("site_access_denied"), { databaseCode: "42501" });
  const claims = await auth.supabaseUser.auth.getClaims(token);
  let session: string;
  try {
    session = siteUuid(claims.data?.claims?.session_id);
  } catch {
    throw Object.assign(new Error("site_access_denied"), { databaseCode: "42501" });
  }
  if (
    claims.error ||
    (await rpc(auth.supabaseAdmin as unknown as Admin, "check_kova_site_auth_session", {
      p_user: auth.userId,
      p_session: session,
    })) !== true
  )
    throw Object.assign(new Error("site_access_denied"), { databaseCode: "42501" });
  return session;
}
function payload(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new SiteInputError();
  return value as Record<string, unknown>;
}
function title(value: unknown) {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > 100 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new SiteInputError("site_title_invalid");
  return value.trim();
}
function failure(error: unknown) {
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  if (error instanceof SiteInputError) return json({ error: error.code }, 400);
  const code = (error as { databaseCode?: string })?.databaseCode;
  const status =
    code === "42501"
      ? 403
      : code === "P0002"
        ? 404
        : code === "40001" || code === "23505"
          ? 409
          : code === "54000"
            ? 413
            : code === "22023" || code === "23514"
              ? 400
              : 503;
  return json(
    {
      error:
        status === 403
          ? "site_access_denied"
          : status === 404
            ? "site_unavailable"
            : status === 409
              ? "site_changed_refresh_required"
              : status === 413
                ? "site_capacity_reached"
                : "site_operation_unavailable",
    },
    status,
  );
}
export const Route = createFileRoute("/api/sites")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        try {
          await currentSiteSession(auth, request);
          const limit = await consumeApplicationRateLimit({
            identity: `user:${auth.userId}`,
            action: "site_read",
            limit: 60,
            windowSeconds: 60,
          });
          if (!limit.allowed) return json({ error: "site_rate_limited" }, 429);
          const url = new URL(request.url);
          if ([...url.searchParams.keys()].some((k) => !["siteId", "versionId"].includes(k)))
            throw new SiteInputError();
          const site = url.searchParams.has("siteId")
            ? siteUuid(url.searchParams.get("siteId"))
            : null;
          const version = url.searchParams.has("versionId")
            ? siteUuid(url.searchParams.get("versionId"))
            : null;
          if (version && !site) throw new SiteInputError();
          const result = await rpc(auth.supabaseAdmin as unknown as Admin, "read_kova_sites", {
            p_owner: auth.userId,
            p_site: site,
            p_version: version,
          });
          return json({
            ...(result as object),
            hostingReady: (await readySiteHosting(process.env)) !== null,
          });
        } catch (error) {
          return failure(error);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        try {
          const authSession = await currentSiteSession(auth, request);
          const banned = await assertNotBanned(auth);
          if (banned) return banned;
          const limit = await consumeApplicationRateLimit({
            identity: `user:${auth.userId}`,
            action: "site_mutation",
            limit: 20,
            windowSeconds: 60,
          });
          if (!limit.allowed) return json({ error: "site_rate_limited" }, 429);
          if (
            request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
            "application/json"
          )
            return json({ error: "json_required" }, 415);
          const input = payload(await readBoundedJsonObject(request, SITE_LIMITS.bodyBytes), [
            "action",
            "siteId",
            "mutationId",
            "revision",
            "payload",
          ]);
          const siteId = siteUuid(input.siteId),
            admin = auth.supabaseAdmin as unknown as Admin;
          const hosting =
            input.action === "ticket" || input.action === "publish"
              ? await readySiteHosting(process.env)
              : null;
          if (input.action === "ticket") {
            if (!hosting) return json({ error: "site_hosting_not_configured" }, 503);
            const values = payload(input.payload, ["versionId"]),
              preview = values.versionId ? siteUuid(values.versionId) : null;
            const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
            await rpc(admin, "issue_kova_site_ticket", {
              p_user: auth.userId,
              p_site: siteId,
              p_token_hash: await sha256(token),
              p_auth_session: authSession,
              p_preview: preview,
            });
            return json({ url: siteOrigin(hosting, siteId) + "/__kova/access#" + token });
          }
          const mutationId = siteUuid(input.mutationId);
          if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0)
            throw new SiteInputError();
          let action = input.action;
          let values: Record<string, unknown>;
          if (action === "create" || action === "rename") {
            const v = payload(input.payload, ["title", "slug"]);
            values = { title: title(v.title), slug: siteSlug(v.slug) };
          } else if (action === "saveVersion") {
            const v = payload(input.payload, ["versionId", "files"]);
            values = { versionId: siteUuid(v.versionId), ...(await inspectSiteFiles(v.files)) };
            delete values.bytes;
          } else if (action === "importWork") {
            const v = payload(input.payload, ["versionId", "deliverableId"]),
              id = siteUuid(v.deliverableId);
            const row = (await auth.supabaseUser
              .from("agent_deliverables" as never)
              .select("id,owner_id,mime_type,storage_reference,integrity_hash,status")
              .eq("owner_id", auth.userId)
              .eq("id", id)
              .neq("status", "deleted")
              .single()) as unknown as {
              data: { mime_type: string; storage_reference: string; integrity_hash: string } | null;
              error: unknown;
            };
            if (row.error || row.data?.mime_type !== "text/html")
              throw new SiteInputError("site_work_source_unavailable");
            const ref = parseAgentStorageReference(row.data.storage_reference);
            const downloaded = await auth.supabaseUser.storage.from(ref.bucket).download(ref.path);
            if (
              downloaded.error ||
              !downloaded.data ||
              downloaded.data.size > SITE_LIMITS.fileBytes
            )
              throw new SiteInputError("site_work_source_unavailable");
            const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
            if ((await sha256(bytes)) !== row.data.integrity_hash)
              throw new SiteInputError("site_work_source_unverified");
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 8192)
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            values = {
              versionId: siteUuid(v.versionId),
              ...(await inspectSiteFiles([{ path: "index.html", base64: btoa(binary) }])),
            };
            delete values.bytes;
            action = "saveVersion";
          } else if (action === "publish") {
            if (!hosting) return json({ error: "site_hosting_not_configured" }, 503);
            const v = payload(input.payload, ["versionId", "visibility"]);
            if (!["private", "public"].includes(v.visibility as string)) throw new SiteInputError();
            values = { versionId: siteUuid(v.versionId), visibility: v.visibility };
          } else if (action === "grantViewer") {
            const v = payload(input.payload, ["email"]);
            if (
              typeof v.email !== "string" ||
              v.email.length > 254 ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(v.email)
            )
              throw new SiteInputError();
            values = { email: v.email.toLowerCase() };
          } else if (action === "revokeViewer") {
            const v = payload(input.payload, ["viewerId"]);
            values = { viewerId: siteUuid(v.viewerId) };
          } else if (action === "retireVersion") {
            const v = payload(input.payload, ["versionId"]);
            values = { versionId: siteUuid(v.versionId) };
          } else if (action === "unpublish" || action === "delete") {
            values = payload(input.payload, []);
          } else throw new SiteInputError();
          // Advancing prior retirements before reservation makes cleanup recoverable
          // without relying on an activated maintenance schedule.
          await rpc(admin, "cleanup_kova_site_versions", { p_owner: auth.userId, p_limit: 5 });
          const tier = await getCallerTier(auth);
          const result = await rpc(admin, "mutate_kova_site", {
            p_owner: auth.userId,
            p_site: siteId,
            p_mutation: mutationId,
            p_revision: input.revision,
            p_action: action,
            p_payload: values,
            p_storage_limit: STORAGE_LIMITS_BYTES[tier],
          });
          if (action === "delete" || action === "retireVersion")
            await rpc(admin, "cleanup_kova_site_versions", { p_owner: auth.userId, p_limit: 5 });
          return json({ result });
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
