import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { organizationAvailability } from "@/lib/organization-policy.mjs";
import {
  configuredOrganizationSsoProvider,
  type OrganizationDomain,
} from "@/lib/organization-domain.server";
import {
  SCIM_SCHEMA,
  ScimError,
  scimUuid,
  scimIfMatch,
  parseScimResource,
  parseScimQuery,
  applyScimPatch,
  scimDocument,
  scimConfiguration,
  scimDiscovery,
  type ScimKind,
  type ScimRow,
} from "./policy.mjs";
type RpcError = { code?: string; message?: string };
type Admin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }> & {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: RpcError | null }>;
  };
};
const admin = supabaseAdmin as unknown as Admin;
export const scimEnabled = () =>
  organizationAvailability(process.env).available &&
  process.env.KOVA_ORGANIZATION_SCIM_ENABLED === "true";
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/scim+json", ...headers },
  });
export function scimFailure(error: unknown) {
  const status =
    error instanceof ScimError
      ? error.status
      : error instanceof BoundedJsonError
        ? error.status
        : 503;
  return json(
    {
      schemas: [SCIM_SCHEMA.error],
      status: String(status),
      scimType: error instanceof ScimError ? error.code : "serviceUnavailable",
      detail:
        status === 401
          ? "Provisioning credential is invalid or inactive."
          : status === 412
            ? "Resource changed. Read its current version before retrying."
            : status === 428
              ? "If-Match is required for this operation."
              : status === 503
                ? "Organization provisioning is unavailable."
                : "The provisioning request could not be accepted.",
    },
    status,
  );
}
export async function scimRpc(
  client: Admin,
  request: Request,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(6000)]);
  signal.throwIfAborted();
  const result = await client.rpc(name, args).abortSignal(signal);
  signal.throwIfAborted();
  if (result.error) {
    const code = result.error.code;
    throw new ScimError(
      code === "42501"
        ? 401
        : code === "40001"
          ? 412
          : code === "23505"
            ? 409
            : code === "P0002"
              ? 404
              : code === "54000"
                ? 429
                : ["22023", "22P02", "23514", "23502"].includes(code ?? "")
                  ? 400
                  : 503,
      code === "23505" ? "uniqueness" : code === "40001" ? "invalidVers" : "invalidValue",
    );
  }
  return result.data;
}
async function rate(identity: string, mutation: boolean) {
  const result = await consumeApplicationRateLimit({
    identity,
    action: mutation ? "organization_scim_mutation" : "organization_scim_read",
    limit: mutation ? 60 : 180,
    windowSeconds: 60,
  });
  if (!result.allowed) throw new ScimError(result.status === "limited" ? 429 : 503, "tooMany");
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function assertRegistry(organizationId: string, value: unknown) {
  const info = value as { providerId?: string; domain?: OrganizationDomain };
  try {
    if (
      !info?.domain ||
      configuredOrganizationSsoProvider(organizationId, info.domain) !== info.providerId
    )
      throw new Error();
  } catch {
    throw new ScimError(503);
  }
}
async function body(request: Request) {
  if (
    !["application/scim+json", "application/json"].includes(
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "",
    )
  )
    throw new ScimError(415);
  return readBoundedJsonObject(
    request,
    32_000,
    AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
  );
}
export async function receiveScim(request: Request, organizationId: string, splat: string) {
  try {
    if (!scimEnabled()) throw new ScimError(503);
    const organization = scimUuid(organizationId),
      bearer = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.get("authorization") ?? "");
    if (!bearer) throw new ScimError(401);
    const tokenHash = hash(bearer[1]);
    const rpc = (operation: string, data: Record<string, unknown> = {}) =>
      scimRpc(admin, request, "organization_scim_rpc", {
        p_org: organization,
        p_token_hash: tokenHash,
        p_operation: operation,
        p_data: data,
      });
    assertRegistry(organization, await rpc("authorize"));
    await rate(`organization:${organization}`, request.method !== "GET");
    const parts = splat.split("/");
    if (parts.some((p) => !p) || parts.length > 2) throw new ScimError(404);
    if (parts[0] === "ServiceProviderConfig" && parts.length === 1 && request.method === "GET")
      return json(scimConfiguration());
    if (["Schemas", "ResourceTypes"].includes(parts[0]) && request.method === "GET") {
      if (new URL(request.url).search) throw new ScimError(400);
      return json(scimDiscovery(parts[0] as "Schemas" | "ResourceTypes", parts[1]));
    }
    if (!["Users", "Groups"].includes(parts[0])) throw new ScimError(404);
    const kind = parts[0] as ScimKind,
      id = parts[1] ? scimUuid(parts[1]) : null;
    const base = `${new URL(request.url).origin}/api/scim/v2/${organization}`;
    const document = (row: unknown) => scimDocument(kind, row as ScimRow, base);
    if (request.method === "GET") {
      if (id) {
        if (new URL(request.url).search) throw new ScimError(400);
        const value = document(await rpc("get", { kind, id }));
        return json(value, 200, { ETag: value.meta.version });
      }
      const query = parseScimQuery(request.url, kind),
        result = (await rpc("list", { kind, ...query })) as { rows: ScimRow[]; total: number };
      return json({
        schemas: [SCIM_SCHEMA.list],
        totalResults: result.total,
        startIndex: query.startIndex,
        itemsPerPage: result.rows.length,
        Resources: result.rows.map(document),
      });
    }
    if (new URL(request.url).search) throw new ScimError(400);
    if (request.method === "POST" && !id) {
      const value = document(
        await rpc("create", { kind, resource: parseScimResource(kind, await body(request)) }),
      );
      return json(value, 201, { ETag: value.meta.version, Location: value.meta.location });
    }
    if (!id || !["PUT", "PATCH", "DELETE"].includes(request.method)) throw new ScimError(405);
    const expectedRevision = scimIfMatch(request.headers.get("if-match"));
    if (request.method === "DELETE") {
      await rpc("delete", { kind, id, expectedRevision });
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    const input = await body(request);
    let resource;
    if (request.method === "PATCH") {
      const current = (await rpc("get", { kind, id })) as ScimRow;
      if (current.revision !== expectedRevision) throw new ScimError(412, "invalidVers");
      resource = applyScimPatch(kind, document(current), input);
    } else resource = parseScimResource(kind, input);
    const value = document(await rpc("replace", { kind, id, expectedRevision, resource }));
    return json(value, 200, { ETag: value.meta.version });
  } catch (error) {
    return scimFailure(error);
  }
}
export async function administerScim(request: Request) {
  try {
    if (request.method !== "GET" && isCrossSiteMutation(request)) throw new ScimError(403);
    const auth = await requireVerifiedUser(request);
    if (auth instanceof Response) return auth;
    const input =
      request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams)
        : await body(request);
    const keys =
      request.method === "GET"
        ? ["expectedUserId", "organizationId"]
        : ["expectedUserId", "organizationId", "operation", "expectedRevision", "consent"];
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new ScimError(400);
    if (scimUuid(input.expectedUserId) !== auth.userId) throw new ScimError(403);
    const organization = scimUuid(input.organizationId);
    if (!scimEnabled()) return json({ available: false });
    await rate(`user:${auth.userId}`, request.method !== "GET");
    const client = auth.supabaseAdmin as unknown as Admin;
    const rpc = (operation: string, data: Record<string, unknown> = {}) =>
      scimRpc(client, request, "organization_scim_admin_rpc", {
        p_actor: auth.userId,
        p_org: organization,
        p_operation: operation,
        p_data: data,
      });
    const status = (await rpc("status")) as Record<string, unknown>;
    let providerReady = true;
    try {
      assertRegistry(organization, status);
    } catch {
      providerReady = false;
    }
    if (request.method === "GET") {
      const { domain, ...safe } = status;
      void domain;
      return json({
        available: true,
        ...safe,
        enabled: Boolean(status.enabled) && providerReady,
        providerReady,
      });
    }
    if (
      !["rotate", "disable"].includes(String(input.operation)) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      Number(input.expectedRevision) < 0
    )
      throw new ScimError(400);
    if (input.operation === "rotate" && (input.consent !== true || !providerReady))
      throw new ScimError(409);
    const token = input.operation === "rotate" ? randomBytes(32).toString("base64url") : undefined;
    const result = (await rpc(String(input.operation), {
      expectedRevision: input.expectedRevision,
      ...(token ? { tokenHash: hash(token) } : {}),
    })) as Record<string, unknown>;
    return json({ available: true, ...result, ...(token ? { token } : {}) });
  } catch (error) {
    return scimFailure(error);
  }
}
