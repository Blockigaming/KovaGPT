import assert from "node:assert/strict";
import test from "node:test";

import {
  API_METHOD_POLICY_ROUTES,
  getDeclaredApiMethodsForPath,
  rejectUnsupportedApiMethod,
} from "../../src/lib/api-method-policy.server.mjs";

const request = (path, method) => new Request(`https://kovagpt.com${path}`, { method });

async function assertMethodNotAllowed(path, method, allow) {
  const response = rejectUnsupportedApiMethod(request(path, method));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), allow);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/u);
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
}

test("the centralized method inventory contains all 43 audited server-handler routes", () => {
  assert.equal(API_METHOD_POLICY_ROUTES.length, 43);
  assert.equal(new Set(API_METHOD_POLICY_ROUTES.map(({ path }) => path)).size, 43);
});

test("supported account, chat, health, memory, and agent methods pass through unchanged", () => {
  for (const [path, method] of [
    ["/api/account", "DELETE"],
    ["/api/chat", "POST"],
    ["/api/health", "GET"],
    ["/api/health", "HEAD"],
    ["/api/memory", "GET"],
    ["/api/memory", "HEAD"],
    ["/api/memory", "POST"],
    ["/api/memory", "DELETE"],
    ["/api/agents/runs", "GET"],
    ["/api/agents/runs", "POST"],
    ["/api/agents/runs", "PATCH"],
    ["/api/agents/teams", "GET"],
    ["/api/agents/teams", "POST"],
    ["/api/agents/teams", "PATCH"],
    ["/email/unsubscribe", "GET"],
    ["/email/unsubscribe", "HEAD"],
    ["/email/unsubscribe", "POST"],
    ["/lovable/email/transactional/send", "POST"],
    ["/.mcp/invoke-tool/research", "POST"],
    ["/.mcp/list-tools", "GET"],
    ["/.mcp/list-tools", "HEAD"],
    ["/.mcp/list-tools", "POST"],
    ["/.well-known/oauth-protected-resource", "GET"],
    ["/.well-known/oauth-protected-resource", "HEAD"],
    ["/mcp", "GET"],
    ["/mcp", "HEAD"],
    ["/sitemap.xml", "GET"],
    ["/sitemap.xml", "HEAD"],
  ]) {
    assert.equal(rejectUnsupportedApiMethod(request(path, method)), null, `${method} ${path}`);
  }
});

test("unsupported methods return JSON 405 responses with Allow and no-store", async () => {
  await assertMethodNotAllowed("/api/account", "POST", "DELETE");
  await assertMethodNotAllowed("/api/chat", "GET", "POST");
  await assertMethodNotAllowed("/api/health", "POST", "GET, HEAD");
  await assertMethodNotAllowed("/api/memory", "PUT", "GET, HEAD, POST, DELETE");
  await assertMethodNotAllowed("/api/agents/runs", "DELETE", "GET, HEAD, POST, PATCH");
  await assertMethodNotAllowed("/api/agents/teams", "DELETE", "GET, HEAD, POST, PATCH");
  await assertMethodNotAllowed("/email/unsubscribe", "PUT", "GET, HEAD, POST");
  await assertMethodNotAllowed("/lovable/email/transactional/send", "GET", "POST");
  await assertMethodNotAllowed("/lovable/email/suppression", "HEAD", "POST");
  await assertMethodNotAllowed("/.mcp/invoke-tool/research", "GET", "POST");
  await assertMethodNotAllowed("/sitemap.xml", "POST", "GET, HEAD");
});

test("the dynamic OAuth callback matcher accepts exactly one provider segment", async () => {
  assert.deepEqual(getDeclaredApiMethodsForPath("/api/integrations/oauth/callback/google"), [
    "GET",
  ]);
  assert.deepEqual(getDeclaredApiMethodsForPath("/api/integrations/oauth/callback/microsoft"), [
    "GET",
  ]);
  assert.equal(getDeclaredApiMethodsForPath("/api/integrations/oauth/callback"), null);
  assert.equal(getDeclaredApiMethodsForPath("/api/integrations/oauth/callback/google/extra"), null);

  assert.equal(
    rejectUnsupportedApiMethod(
      request("/api/integrations/oauth/callback/google?code=code&state=state", "GET"),
    ),
    null,
  );
  assert.equal(
    rejectUnsupportedApiMethod(
      request("/api/integrations/oauth/callback/google?code=code&state=state", "HEAD"),
    ),
    null,
  );
  await assertMethodNotAllowed(
    "/api/integrations/oauth/callback/google?code=code&state=state",
    "POST",
    "GET, HEAD",
  );
});

test("the dynamic MCP tool matcher accepts exactly one tool segment", async () => {
  assert.deepEqual(getDeclaredApiMethodsForPath("/.mcp/invoke-tool/research"), ["POST"]);
  assert.equal(getDeclaredApiMethodsForPath("/.mcp/invoke-tool"), null);
  assert.equal(getDeclaredApiMethodsForPath("/.mcp/invoke-tool/research/extra"), null);
});

test("non-API and unknown API paths remain owned by TanStack", () => {
  assert.equal(rejectUnsupportedApiMethod(request("/", "POST")), null);
  assert.equal(rejectUnsupportedApiMethod(request("/api", "POST")), null);
  assert.equal(rejectUnsupportedApiMethod(request("/api/not-a-route", "POST")), null);
  assert.equal(rejectUnsupportedApiMethod(request("/lovable/email/not-a-route", "POST")), null);
});
