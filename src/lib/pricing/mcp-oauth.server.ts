import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { requireVerifiedUser, requireUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { developerDatabase, developerEnabled } from "./developer-platform.server";
import {
  MCP_OAUTH_SCOPES,
  mcpIssuer,
  mcpUuid,
  mcpScopes,
  mcpClientRegistration,
  mcpAuthorizationRequest,
  mcpVerifier,
  mcpCanonical,
  mcpReviewPayload,
} from "./mcp-oauth-policy.mjs";
const json = (value: unknown, status = 200, cors = false) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(cors ? { "Access-Control-Allow-Origin": "*" } : {}),
    },
  });
function fail(code: string): never {
  throw new Error(`mcp_oauth_${code}`);
}
function settings() {
  const issuer = mcpIssuer(runtimeEnv("KOVA_MCP_ISSUER"));
  return {
    issuer,
    resource: `${issuer}/mcp`,
    enabled: developerEnabled() && runtimeEnv("KOVA_MCP_OAUTH_ENABLED") === "true",
    registration: runtimeEnv("KOVA_MCP_DYNAMIC_REGISTRATION_ENABLED") === "true",
  };
}
function requireEnabled() {
  const value = settings();
  if (!value.enabled) fail("temporarily_unavailable");
  return value;
}
function hash(value: unknown) {
  return createHash("sha256").update(mcpCanonical(value)).digest("hex");
}
function digest(value: string) {
  const pepper = runtimeEnv("DEVELOPER_KEY_PEPPER");
  if (!pepper || pepper.length < 32 || pepper.length > 512) fail("temporarily_unavailable");
  return createHmac("sha256", pepper).update(`mcp-oauth-v1\n${value}`).digest("hex");
}
function secret(kind: "a" | "r" | "c") {
  const id = randomUUID(),
    value = `kmcp_${kind}_${id}_${randomBytes(32).toString("base64url")}`;
  return { id, value, digest: digest(value) };
}
function parseSecret(value: unknown, kind?: "a" | "r" | "c") {
  if (typeof value !== "string") fail("invalid_grant");
  const match = /^kmcp_([arc])_([a-f0-9-]{36})_([A-Za-z0-9_-]{43})$/u.exec(value);
  if (!match || (kind && match[1] !== kind)) fail("invalid_grant");
  return { id: mcpUuid(match[2]), digest: digest(value), kind: match[1] };
}
async function rpc(name: string, args: Record<string, unknown>, db = developerDatabase()) {
  const result = await db.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
  if (result.error) {
    const message = result.error.message;
    if (/^mcp_oauth_[a-z_]+$/u.test(message)) throw new Error(message);
    fail("temporarily_unavailable");
  }
  return result.data;
}
async function rate(request: Request, operation: string, owner?: string) {
  const identity = owner
    ? `mcp-owner:${owner}`
    : `mcp-ip:${createHash("sha256").update(resolveAnonymousClientKey(request.headers)).digest("hex")}`;
  const result = await consumeApplicationRateLimit({
    identity,
    action: `mcp_oauth_${operation}`,
    limit: operation === "register" ? 10 : 60,
    windowSeconds: operation === "register" ? 3600 : 60,
  });
  if (!result.allowed) fail(result.status === "limited" ? "rate_limit" : "temporarily_unavailable");
}
function failure(error: unknown, cors = false) {
  const message = error instanceof Error ? error.message : "";
  let code = /^mcp_oauth_[a-z_]+$/u.test(message)
    ? message.slice("mcp_oauth_".length)
    : "temporarily_unavailable";
  const status =
    code === "invalid_client"
      ? 401
      : code === "access_denied"
        ? 403
        : code === "rate_limit"
          ? 429
          : /unavailable|capacity/u.test(code)
            ? 503
            : 400;
  if (code === "capacity" || code === "configuration_unavailable" || code === "rate_limit")
    code = "temporarily_unavailable";
  return json({ error: code }, status, cors);
}
export function mcpOAuthMetadata(resource = false) {
  try {
    const config = requireEnabled();
    return json(
      resource
        ? {
            resource: config.resource,
            authorization_servers: [config.issuer],
            scopes_supported: MCP_OAUTH_SCOPES,
            bearer_methods_supported: ["header"],
            resource_name: "KovaGPT Developer MCP",
          }
        : {
            issuer: config.issuer,
            authorization_endpoint: `${config.issuer}/oauth/mcp/authorize`,
            token_endpoint: `${config.issuer}/oauth/mcp/token`,
            revocation_endpoint: `${config.issuer}/oauth/mcp/revoke`,
            ...(config.registration
              ? { registration_endpoint: `${config.issuer}/oauth/mcp/register` }
              : {}),
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            revocation_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
            scopes_supported: MCP_OAUTH_SCOPES,
            authorization_response_iss_parameter_supported: true,
          },
      200,
      true,
    );
  } catch {
    return json({ error: "external_connection_unavailable" }, 404, true);
  }
}
export function mcpOAuthAnonymousChallenge(request: Request): Response | null {
  if (request.headers.has("authorization")) return null;
  try {
    requireEnabled();
    return mcpOAuthChallenge(
      json(
        { error: { code: "developer_unauthorized", message: "Authentication required" } },
        401,
        true,
      ),
    );
  } catch {
    return null;
  }
}
export function mcpOAuthChallenge(response: Response) {
  if (response.status !== 401) return response;
  try {
    const config = requireEnabled();
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate");
    response.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource", scope="${MCP_OAUTH_SCOPES.join(" ")}"`,
    );
  } catch {
    /* Disabled deployments do not advertise an unavailable issuer. */
  }
  return response;
}
async function form(request: Request, keys: string[]) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim() !==
    "application/x-www-form-urlencoded"
  )
    fail("invalid_request");
  const input = new URLSearchParams(await readUtf8BodyBounded(request, 8192));
  if (
    [...input.keys()].some((key) => !keys.includes(key)) ||
    [...input.keys()].some((key) => input.getAll(key).length !== 1)
  )
    fail("invalid_request");
  return input;
}
export async function handleMcpOAuthEndpoint(request: Request, action: string) {
  const cors = ["token", "register", "revoke"].includes(action);
  if (request.method === "OPTIONS" && cors)
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      },
    });
  try {
    const config = requireEnabled();
    await rate(request, action);
    if (action === "authorize" && request.method === "GET") {
      const input = mcpAuthorizationRequest(new URL(request.url).searchParams, config.issuer),
        id = randomUUID();
      await rpc("begin_mcp_oauth_request", {
        p_id: id,
        p_client: input.clientId,
        p_request: input,
        p_hash: hash(input),
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${config.issuer}/developers/authorize?request_id=${id}`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (request.method !== "POST") return json({ error: "invalid_request" }, 405, cors);
    if (action === "register") {
      if (!config.registration) fail("access_denied");
      const metadata = mcpClientRegistration(await readBoundedJsonObject(request, 16384));
      return json(
        await rpc("register_mcp_oauth_client", {
          p_id: randomUUID(),
          p_owner: null,
          p_metadata: metadata,
        }),
        201,
        true,
      );
    }
    if (action === "revoke") {
      const input = await form(request, ["client_id", "token", "token_type_hint"]);
      let token;
      try {
        token = parseSecret(input.get("token"));
      } catch {
        return json({}, 200, true);
      }
      await rpc("revoke_mcp_oauth_token", {
        p_client: mcpUuid(input.get("client_id")),
        p_token: token.id,
        p_digest: token.digest,
      });
      return json({}, 200, true);
    }
    if (action === "token") {
      const input = await form(request, [
          "grant_type",
          "client_id",
          "redirect_uri",
          "code",
          "code_verifier",
          "resource",
          "refresh_token",
          "scope",
        ]),
        grant = input.get("grant_type");
      if (!["authorization_code", "refresh_token"].includes(grant ?? ""))
        fail("unsupported_grant_type");
      if (input.get("resource") !== config.resource) fail("invalid_target");
      const kind = grant === "authorization_code" ? "code" : "refresh",
        token = parseSecret(
          input.get(kind === "code" ? "code" : "refresh_token"),
          kind === "code" ? "c" : "r",
        ),
        access = secret("a"),
        refresh = secret("r");
      if (kind === "code" && (input.has("refresh_token") || input.has("scope")))
        fail("invalid_request");
      if (
        kind === "refresh" &&
        (input.has("code") || input.has("code_verifier") || input.has("redirect_uri"))
      )
        fail("invalid_request");
      const result = await rpc("exchange_mcp_oauth_token", {
        p_kind: kind,
        p_token: token.id,
        p_digest: token.digest,
        p_client: mcpUuid(input.get("client_id")),
        p_resource: config.resource,
        p_redirect: kind === "code" ? input.get("redirect_uri") : null,
        p_challenge:
          kind === "code"
            ? createHash("sha256")
                .update(mcpVerifier(input.get("code_verifier")))
                .digest("base64url")
            : null,
        p_scopes: input.has("scope") ? mcpScopes(input.get("scope")) : null,
        p_access: access.id,
        p_access_digest: access.digest,
        p_refresh: refresh.id,
        p_refresh_digest: refresh.digest,
      });
      if (!result || result.error)
        return json({ error: result?.error ?? "invalid_grant" }, 400, true);
      return json(
        {
          access_token: access.value,
          token_type: "Bearer",
          expires_in: result.expiresIn,
          ...(result.refreshAllowed ? { refresh_token: refresh.value } : {}),
          scope: result.scope,
        },
        200,
        true,
      );
    }
    return json({ error: "invalid_request" }, 404, cors);
  } catch (error) {
    return failure(error, cors);
  }
}
const allowedOrigins = new WeakMap<Request, string>();
export async function authenticateMcpOAuth(request: Request) {
  const config = requireEnabled(),
    authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("developer_unauthorized");
  await rate(request, "access");
  let token;
  try {
    token = parseSecret(authorization.slice(7), "a");
  } catch {
    throw new Error("developer_unauthorized");
  }
  const db = developerDatabase(),
    identity = await rpc(
      "validate_mcp_oauth_access",
      { p_token: token.id, p_digest: token.digest, p_resource: config.resource },
      db,
    );
  if (!identity) throw new Error("developer_unauthorized");
  const origin = request.headers.get("origin");
  if (
    origin &&
    (!Array.isArray(identity.redirectUris) ||
      !identity.redirectUris.some((uri: string) => new URL(uri).origin === origin))
  )
    throw new Error("developer_origin_invalid");
  if (origin) allowedOrigins.set(request, origin);
  return {
    id: identity.id,
    account_id: identity.account_id,
    project_id: identity.project_id,
    capabilities: identity.capabilities,
    ownerId: identity.ownerId,
    secret_digest: null,
    db,
  };
}

export async function handleMcpOAuthOwner(request: Request) {
  try {
    if (request.method !== "GET" && isCrossSiteMutation(request)) fail("access_denied");
    const auth =
      request.method === "GET" ? await requireUser(request) : await requireVerifiedUser(request);
    if (auth instanceof Response) return auth;
    if (request.headers.get("X-Kova-Expected-User") !== auth.userId) fail("access_denied");
    await rate(request, "owner", auth.userId);
    const db = developerDatabase(),
      url = new URL(request.url),
      id = url.searchParams.get("request_id");
    if (request.method === "GET") {
      if (id) {
        requireEnabled();
        return json(
          await rpc("read_mcp_oauth_consent", { p_owner: auth.userId, p_request: mcpUuid(id) }, db),
        );
      }
      const cursor = url.searchParams.get("after") ?? "00000000-0000-0000-0000-000000000000";
      if (cursor !== "00000000-0000-0000-0000-000000000000") mcpUuid(cursor);
      const grants = await db
        .from("mcp_oauth_grant_export_rows")
        .select("*")
        .eq("owner_id", auth.userId)
        .gt("id", cursor)
        .order("id")
        .limit(51)
        .abortSignal(AbortSignal.timeout(10000));
      const clients = await db
        .from("mcp_oauth_clients")
        .select("id,metadata,active,expires_at")
        .eq("registered_by", auth.userId)
        .eq("active", true)
        .gt("expires_at", new Date().toISOString())
        .order("id")
        .limit(20)
        .abortSignal(AbortSignal.timeout(10000));
      if (grants.error || clients.error || !grants.data || !clients.data)
        fail("temporarily_unavailable");
      return json({
        grants: grants.data.slice(0, 50),
        nextCursor: grants.data.length > 50 ? grants.data[49].id : null,
        clients: clients.data,
      });
    }
    const input = await readBoundedJsonObject(request, 16384);
    if (input.operation === "register")
      return json(
        await rpc(
          "register_mcp_oauth_client",
          {
            p_id: randomUUID(),
            p_owner: auth.userId,
            p_metadata: mcpClientRegistration(input.metadata),
          },
          db,
        ),
        201,
      );
    if (input.operation === "retire_client")
      return json({
        retired: await rpc(
          "retire_mcp_oauth_client",
          { p_owner: auth.userId, p_client: mcpUuid(input.clientId) },
          db,
        ),
      });
    if (input.operation === "revoke")
      return json({
        revoked: await rpc(
          "revoke_mcp_oauth_grant",
          { p_owner: auth.userId, p_grant: mcpUuid(input.grantId) },
          db,
        ),
      });
    if (input.operation !== "decide" || typeof input.approve !== "boolean") fail("invalid_request");
    const config = requireEnabled(),
      requestId = mcpUuid(input.requestId),
      details = await rpc(
        "read_mcp_oauth_consent",
        { p_owner: auth.userId, p_request: requestId },
        db,
      );
    if (details.requestHash !== input.requestHash) fail("invalid_request");
    const review = input.approve
      ? mcpReviewPayload(details, input.projectId, input.scopes, input.limits)
      : null;
    if (review && hash(review) !== input.reviewHash) fail("invalid_request");
    const code = secret("c");
    const result = await rpc(
      "decide_mcp_oauth_consent",
      {
        p_owner: auth.userId,
        p_request: requestId,
        p_request_hash: details.requestHash,
        p_approve: input.approve,
        p_project: review?.projectId ?? null,
        p_scopes: review?.scopes ?? null,
        p_limits: review?.limits ?? null,
        p_review_hash: review ? hash(review) : null,
        p_grant: randomUUID(),
        p_key: randomUUID(),
        p_key_digest: randomBytes(32).toString("hex"),
        p_code: code.id,
        p_code_digest: code.digest,
      },
      db,
    );
    const target = new URL(result.redirectUri);
    target.searchParams.set("state", result.state);
    target.searchParams.set("iss", config.issuer);
    if (result.denied) target.searchParams.set("error", "access_denied");
    else target.searchParams.set("code", code.value);
    return json({ redirectUri: target.href });
  } catch (error) {
    return failure(error);
  }
}

export function mcpOAuthResponseHeaders(request: Request, response: Response) {
  const origin = allowedOrigins.get(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return mcpOAuthChallenge(response);
}
export function mcpOAuthPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version",
      "Access-Control-Max-Age": "600",
    },
  });
}
