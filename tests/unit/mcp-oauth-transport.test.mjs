import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
import {
  fixture,
  owner,
  other,
  client,
  id,
  limits,
  resource,
  redirect,
} from "../helpers/mcp-oauth-fixture.mjs";
import {
  mcpAuthorizationRequest,
  mcpClientRegistration,
  mcpScopes,
  mcpReviewPayload,
  mcpCanonical,
  mcpRedirect,
  mcpIssuer,
} from "../../src/lib/pricing/mcp-oauth-policy.mjs";
const slot = Symbol.for("kova.mcp-oauth-transport");
async function server(db) {
  const state = {
    env: {
      KOVA_MCP_ISSUER: "https://kova.example",
      KOVA_MCP_OAUTH_ENABLED: "true",
      DEVELOPER_KEY_PEPPER: "p".repeat(64),
    },
    rate: true,
    owner,
    calls: [],
  };
  state.db = {
    rpc(name, args) {
      state.calls.push({ name, args });
      return {
        async abortSignal() {
          try {
            const keys = Object.keys(args);
            const q = `select public.${name}(${keys.map((key, index) => `${key}=>$${index + 1}`).join(",")}) result`;
            return { data: (await db.query(q, Object.values(args))).rows[0].result, error: null };
          } catch (error) {
            return { data: null, error: { message: error.message } };
          }
        },
      };
    },
  };
  globalThis[slot] = state;
  let source = await readFile("src/lib/pricing/mcp-oauth.server.ts", "utf8");
  source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "node:crypto") return full;
    if (path.endsWith(".mjs") && !path.includes("auth-security") && !path.includes("chat-ingress"))
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(
          new URL(
            path.startsWith("./")
              ? `../../src/lib/pricing/${path.slice(2)}`
              : `../../src/lib/${path.slice("@/lib/".length)}`,
            import.meta.url,
          ).href,
        ),
      );
    if (path === "@/lib/runtime-env.server")
      return 'const runtimeEnv=(name)=>globalThis[Symbol.for("kova.mcp-oauth-transport")].env[name];';
    if (path === "./developer-platform.server")
      return 'const developerDatabase=()=>globalThis[Symbol.for("kova.mcp-oauth-transport")].db,developerEnabled=()=>true;';
    if (path === "@/lib/api-auth.server")
      return 'const requireUser=async()=>({userId:globalThis[Symbol.for("kova.mcp-oauth-transport")].owner}),requireVerifiedUser=requireUser;';
    if (path === "@/lib/distributed-rate-limit.server")
      return 'const consumeApplicationRateLimit=async()=>({allowed:globalThis[Symbol.for("kova.mcp-oauth-transport")].rate,status:"limited"});';
    if (path === "@/lib/auth-security.mjs")
      return 'const isCrossSiteMutation=(request)=>request.headers.get("sec-fetch-site")==="cross-site";';
    if (path === "@/lib/chat-ingress.server.mjs")
      return 'const resolveAnonymousClientKey=()=>"fixture-ip";';
    throw new Error(`Unstubbed import ${path}`);
  });
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(output + `\n//${crypto.randomUUID()}`).toString("base64")}`
  );
  return { state, mod };
}
const sha = (input) => createHash("sha256").update(mcpCanonical(input)).digest("hex");
function bodyRequest(action, body) {
  return new Request(`https://kova.example/oauth/mcp/${action}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}
function ownerRequest(body, query = "", captured = owner) {
  return new Request(`https://kova.example/api/developer/mcp${query}`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Kova-Expected-User": captured,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function begin(mod) {
  const verifier = "v".repeat(43),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: "code",
    scope: "chat files",
    state: "client-csrf-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });
  const response = await mod.handleMcpOAuthEndpoint(
    new Request(`https://kova.example/oauth/mcp/authorize?${params}`),
    "authorize",
  );
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location"));
  assert.equal(target.origin, "https://kova.example");
  assert.equal(target.pathname, "/developers/authorize");
  const requestId = target.searchParams.get("request_id");
  return { requestId, verifier };
}
async function authorize(f, mod) {
  const { requestId, verifier } = await begin(mod);
  const details = await (
    await mod.handleMcpOAuthOwner(ownerRequest(null, `?request_id=${requestId}`))
  ).json();
  const review = mcpReviewPayload(details, f.account.projectId, ["chat", "files"], limits);
  const response = await mod.handleMcpOAuthOwner(
    ownerRequest({
      operation: "decide",
      requestId,
      requestHash: details.requestHash,
      approve: true,
      projectId: f.account.projectId,
      scopes: ["chat", "files"],
      limits,
      reviewHash: sha(review),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json(),
    target = new URL(result.redirectUri);
  assert.equal(target.origin, "https://client.example");
  assert.equal(target.searchParams.get("state"), "client-csrf-state");
  assert.equal(target.searchParams.get("iss"), "https://kova.example");
  return { code: target.searchParams.get("code"), verifier };
}
test("policy rejects redirect ambiguity, implicit/weak PKCE grants, duplicate scopes and unreviewed spending", () => {
  for (const uri of [
    "http://client.example/cb",
    "https://user:password@client.example/cb",
    "https://client.example/cb#frag",
    "https://client.example/cb?state=chosen",
    "https://client.example/cb\n",
    "http://localhost:8080/cb",
    "http://127.0.0.1/cb",
  ])
    assert.throws(() => mcpRedirect(uri, "native"));
  assert.equal(mcpRedirect("http://127.0.0.1:8080/cb", "native"), "http://127.0.0.1:8080/cb");
  assert.throws(() => mcpIssuer("https://kova.example/path"));
  assert.throws(() => mcpScopes("chat chat"));
  assert.throws(() =>
    mcpClientRegistration({
      client_name: "X",
      redirect_uris: [redirect],
      jwks_uri: "https://private.example/",
    }),
  );
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: "code",
    scope: "chat",
    state: "s",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
    resource,
  });
  assert.equal(mcpAuthorizationRequest(params, "https://kova.example").resource, resource);
  for (const [field, value] of [
    ["code_challenge_method", "plain"],
    ["response_type", "token"],
    ["resource", "https://other.example/mcp"],
  ]) {
    const changed = new URLSearchParams(params);
    changed.set(field, value);
    assert.throws(() => mcpAuthorizationRequest(changed, "https://kova.example"));
  }
  params.append("client_id", client);
  assert.throws(() => mcpAuthorizationRequest(params, "https://kova.example"));
  assert.throws(() =>
    mcpReviewPayload(
      { id: id(4), requestHash: "a".repeat(64), scopes: ["chat"] },
      id(5),
      ["chat"],
      { ...limits, request: Infinity },
    ),
  );
});
test("real HTTP authorization/consent/token flow uses SQL one-use state and resource-bound MCP access without exposing keys", async () => {
  const f = await fixture();
  try {
    const { mod } = await server(f.db);
    const auth = await authorize(f, mod);
    const tokenRequest = {
      grant_type: "authorization_code",
      client_id: client,
      redirect_uri: redirect,
      resource,
      code: auth.code,
      code_verifier: auth.verifier,
    };
    const result = await mod.handleMcpOAuthEndpoint(bodyRequest("token", tokenRequest), "token");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const tokens = await result.json();
    assert.match(tokens.access_token, /^kmcp_a_/);
    assert.match(tokens.refresh_token, /^kmcp_r_/);
    const request = new Request(resource, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.access_token}`, origin: "https://client.example" },
    });
    const identity = await mod.authenticateMcpOAuth(request);
    assert.equal(identity.ownerId, owner);
    assert.equal(identity.project_id, f.account.projectId);
    assert.deepEqual(identity.capabilities, ["chat", "files"]);
    assert.equal(identity.secret_digest, null);
    const wrapped = mod.mcpOAuthResponseHeaders(request, Response.json({ ok: true }));
    assert.equal(wrapped.headers.get("access-control-allow-origin"), "https://client.example");
    await assert.rejects(
      mod.authenticateMcpOAuth(
        new Request(resource, {
          headers: {
            authorization: `Bearer ${tokens.access_token}`,
            origin: "https://evil.example",
          },
        }),
      ),
      /origin_invalid/,
    );
    const replay = await mod.handleMcpOAuthEndpoint(bodyRequest("token", tokenRequest), "token");
    assert.equal(replay.status, 400);
    await assert.rejects(mod.authenticateMcpOAuth(request), /unauthorized/);
    assert.equal(
      (
        await f.db.query("select count(*)::int n from mcp_oauth_tokens where digest=$1", [
          tokens.access_token,
        ])
      ).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("consent requires captured current owner and exact reviewed hash; an altered review creates no credential", async () => {
  const f = await fixture();
  try {
    const { mod, state } = await server(f.db);
    const { requestId } = await begin(mod);
    assert.equal(
      (await mod.handleMcpOAuthOwner(ownerRequest(null, `?request_id=${requestId}`, other))).status,
      403,
    );
    const details = await (
      await mod.handleMcpOAuthOwner(ownerRequest(null, `?request_id=${requestId}`))
    ).json();
    const response = await mod.handleMcpOAuthOwner(
      ownerRequest({
        operation: "decide",
        requestId,
        requestHash: details.requestHash,
        approve: true,
        projectId: f.account.projectId,
        scopes: ["chat"],
        limits,
        reviewHash: "f".repeat(64),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await f.db.query("select count(*)::int n from mcp_oauth_grants")).rows[0].n, 0);
    state.owner = other;
    assert.equal(
      (
        await mod.handleMcpOAuthOwner(
          ownerRequest({
            operation: "decide",
            requestId,
            requestHash: details.requestHash,
            approve: false,
          }),
        )
      ).status,
      403,
    );
  } finally {
    await f.db.close();
  }
});
test("discovery, DCR and distributed admission fail closed; malformed endpoints do not redirect to a supplied client", async () => {
  const f = await fixture();
  try {
    const { mod, state } = await server(f.db);
    const anonymous = mod.mcpOAuthAnonymousChallenge(
      new Request(resource, { headers: { Origin: "https://unregistered-client.example" } }),
    );
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("access-control-allow-origin"), "*");
    assert.equal(anonymous.headers.get("access-control-expose-headers"), "WWW-Authenticate");
    assert.match(anonymous.headers.get("www-authenticate"), /resource_metadata=/);
    assert.equal(
      mod.mcpOAuthAnonymousChallenge(
        new Request(resource, { headers: { Authorization: "Bearer invalid" } }),
      ),
      null,
    );
    const metadata = await mod.mcpOAuthMetadata().json();
    assert.equal(metadata.issuer, "https://kova.example");
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.registration_endpoint, undefined);
    const protectedMetadata = await mod.mcpOAuthMetadata(true).json();
    assert.equal(protectedMetadata.resource, resource);
    assert.match(
      mod.mcpOAuthChallenge(new Response(null, { status: 401 })).headers.get("www-authenticate"),
      /resource_metadata=/,
    );
    const registration = () =>
      new Request("https://kova.example/oauth/mcp/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Client",
          redirect_uris: ["https://external.example/cb"],
        }),
      });
    assert.equal((await mod.handleMcpOAuthEndpoint(registration(), "register")).status, 403);
    state.env.KOVA_MCP_DYNAMIC_REGISTRATION_ENABLED = "true";
    assert.equal((await mod.handleMcpOAuthEndpoint(registration(), "register")).status, 201);
    state.rate = false;
    assert.equal((await mod.handleMcpOAuthEndpoint(registration(), "register")).status, 429);
    state.env.KOVA_MCP_OAUTH_ENABLED = "false";
    assert.equal(mod.mcpOAuthAnonymousChallenge(new Request(resource)), null);
    assert.equal(mod.mcpOAuthMetadata().status, 404);
    assert.equal((await mod.handleMcpOAuthEndpoint(registration(), "register")).status, 503);
  } finally {
    await f.db.close();
  }
});
