import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  ORGANIZATION_MAX_BODY_BYTES,
  organizationAvailability,
  OrganizationInputError,
  parseOrganizationMutation,
  parseOrganizationQuery,
} from "@/lib/organization-policy.mjs";
import {
  configuredOrganizationSsoProvider,
  OrganizationDomainError,
  verifyOrganizationDns,
  type OrganizationDomain,
} from "@/lib/organization-domain.server";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcQuery = PromiseLike<RpcResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
};
type Admin = {
  rpc(name: string, args: Record<string, unknown>): RpcQuery;
};
async function boundedRpc(
  admin: Admin,
  request: Request,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  let remove = () => {};
  try {
    signal.throwIfAborted();
    const query = admin.rpc(name, args);
    const operation = query.abortSignal ? query.abortSignal(signal) : query;
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("organization_service_unavailable"));
        signal.addEventListener("abort", abort, { once: true });
        remove = () => signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    remove();
  }
}
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
function fail(error: { code?: string; message?: string } | null): Response {
  const status =
    error?.code === "40001" || error?.code === "23505"
      ? 409
      : error?.code === "42501"
        ? 403
        : error?.code === "P0002"
          ? 404
          : error?.code === "22023" || error?.code === "22P02"
            ? 400
            : error?.code === "54000"
              ? 409
              : 503;
  const specific = new Set([
    "organization_last_owner",
    "organization_recipient_unavailable",
    "organization_domain_proof_required",
    "organization_close_requires_sole_owner",
  ]);
  return json(
    {
      error:
        error?.message && specific.has(error.message)
          ? error.message
          : status === 409
            ? "organization_conflict_or_capacity"
            : status === 403
              ? "organization_permission_denied"
              : status === 404
                ? "organization_not_found"
                : status === 400
                  ? "organization_request_or_recipient_unavailable"
                  : "organization_service_unavailable",
    },
    status,
  );
}
function inputFail(error: unknown): Response {
  if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
  if (error instanceof OrganizationDomainError) return json({ error: error.code }, 409);
  if (error instanceof OrganizationInputError) return json({ error: error.code }, 400);
  return json({ error: "organization_service_unavailable" }, 503);
}
async function rate(userId: string, mutation: boolean): Promise<Response | null> {
  const result = await consumeApplicationRateLimit({
    identity: `user:${userId}`,
    action: mutation ? "organization_mutation" : "organization_read",
    limit: mutation ? 20 : 90,
    windowSeconds: 60,
  });
  return result.allowed
    ? null
    : json(
        {
          error:
            result.status === "limited"
              ? "organization_rate_limited"
              : "organization_protection_unavailable",
        },
        result.status === "limited" ? 429 : 503,
        { "Retry-After": String(result.retryAfter) },
      );
}
export const Route = createFileRoute("/api/organizations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const availability = organizationAvailability(process.env);
        if (!availability.available)
          return json({ ...availability, organizations: [], invitations: [] });
        const blocked = await rate(auth.userId, false);
        if (blocked) return blocked;
        try {
          if (process.env.KOVA_ORGANIZATION_SCIM_ENABLED === "true") {
            const reconciled = await boundedRpc(
              auth.supabaseAdmin as unknown as Admin,
              request,
              "reconcile_organization_scim_membership",
              { p_user: auth.userId },
            );
            if (reconciled.error) return fail(reconciled.error);
          }
          const query = parseOrganizationQuery(request.url);
          const result = await boundedRpc(
            auth.supabaseAdmin as unknown as Admin,
            request,
            "read_organization_workspace",
            {
              p_actor_user_id: auth.userId,
              p_organization_id: query.organizationId,
              p_view: query.view,
              p_cursor: query.cursor,
              p_through: query.through,
              p_limit: query.limit,
            },
          );
          if (result.error) return fail(result.error);
          if (!result.data || typeof result.data !== "object" || Array.isArray(result.data))
            return fail(null);
          return json({ ...availability, ...result.data });
        } catch (error) {
          return inputFail(error);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const availability = organizationAvailability(process.env);
        if (!availability.available)
          return json({ error: "organization_administration_unavailable" }, 503);
        const blocked = await rate(auth.userId, true);
        if (blocked) return blocked;
        if (
          request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json"
        )
          return json({ error: "json_content_type_required" }, 415);
        try {
          const input = parseOrganizationMutation(
            await readBoundedJsonObject(request, ORGANIZATION_MAX_BODY_BYTES),
          );
          if (input.action === "close" && !availability.canClose)
            return json({ error: "organization_closure_policy_not_active" }, 503);
          const admin = auth.supabaseAdmin as unknown as Admin;
          if (process.env.KOVA_ORGANIZATION_SCIM_ENABLED === "true") {
            const reconciled = await boundedRpc(
              admin,
              request,
              "reconcile_organization_scim_membership",
              { p_user: auth.userId },
            );
            if (reconciled.error) return fail(reconciled.error);
          }
          if (input.action === "verifyDomain" || input.action === "configureSso") {
            const read = await boundedRpc(admin, request, "read_organization_workspace", {
              p_actor_user_id: auth.userId,
              p_organization_id: input.organizationId,
            });
            if (read.error) return fail(read.error);
            const workspace = read.data as {
              organization?: { role?: string; revision?: number };
              domains?: OrganizationDomain[];
            } | null;
            if (workspace?.organization?.role !== "owner") return fail({ code: "42501" });
            if (workspace.organization.revision !== input.expectedRevision)
              return fail({ code: "40001" });
            const domain = workspace.domains?.find((item) => item.id === input.payload.domainId);
            if (!domain) return fail({ code: "P0002" });
            input.payload =
              input.action === "verifyDomain"
                ? { domainId: domain.id, verifiedChallenge: await verifyOrganizationDns(domain) }
                : {
                    domainId: domain.id,
                    providerId: configuredOrganizationSsoProvider(input.organizationId, domain),
                  };
          }
          const result = await boundedRpc(admin, request, "mutate_organization", {
            p_actor_user_id: auth.userId,
            p_mutation_id: input.mutationId,
            p_organization_id: input.organizationId,
            p_expected_revision: input.expectedRevision,
            p_action: input.action,
            p_payload: input.payload,
            p_policy_version: process.env.KOVA_ORGANIZATION_POLICY_VERSION,
          });
          return result.error ? fail(result.error) : json({ result: result.data });
        } catch (error) {
          return inputFail(error);
        }
      },
    },
  },
});
