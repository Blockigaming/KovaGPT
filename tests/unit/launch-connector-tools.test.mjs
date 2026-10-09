import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createLaunchToolContext } from "../../src/integrations/launch-tools.server.mjs";
import {
  assertLaunchCertified,
  ConnectorError,
  isLaunchConnector,
} from "../../src/integrations/launch-contracts.mjs";
import { readBoundedJsonObject } from "../../src/lib/bounded-json.server.mjs";
const ownerId = "11111111-1111-4111-8111-111111111111",
  accountId = "33333333-3333-4333-8333-333333333333";
const account = {
  id: accountId,
  owner_id: ownerId,
  provider_id: "outlook",
  status: "connected",
  granted_scopes: ["Mail.Read"],
  deleted_at: null,
};
test("model gets no new tools without certification, even with a connected account", () => {
  const context = createLaunchToolContext({
    ownerId,
    sessionId: "session",
    accounts: [account],
    runtime: {},
  });
  assert.deepEqual(context.tools, []);
  assert.equal(context.hasTool("launch_outlook_list_messages"), false);
});
test("certified model tools bind authenticated owner, session and eligible account IDs", async () => {
  const calls = [];
  const context = createLaunchToolContext({
    ownerId,
    sessionId: "session",
    accounts: [account],
    certified: ["outlook"],
    runtime: {
      execute: async (v) => {
        calls.push(v);
        return { items: [] };
      },
    },
  });
  const name = "launch_outlook_read_message";
  assert.equal(context.tools.length, 2);
  assert.equal(context.hasTool(name), true);
  assert.deepEqual(context.tools[0].function.parameters.properties.accountId.enum, [accountId]);
  await context.execute(name, { accountId, id: "m1" });
  assert.equal(calls[0].ownerId, ownerId);
  assert.equal(calls[0].sessionId, "session");
  assert.equal(calls[0].operation, "read_message");
  await assert.rejects(
    context.execute(name, { accountId, id: "m1", ownerId: "forged" }),
    /invalid_arguments/,
  );
  await assert.rejects(
    context.execute(name, { accountId: ownerId, id: "m1" }),
    /invalid_account_id/,
  );
  await assert.rejects(
    context.execute("launch_outlook_send_message", { accountId }),
    /unsupported_operation/,
  );
});
test("foreign, expired, revoked, deleted and under-scoped accounts expose no model tools", () => {
  for (const invalid of [
    { owner_id: "other" },
    { status: "expired" },
    { status: "revoked" },
    { deleted_at: "now" },
    { granted_scopes: [] },
  ]) {
    const c = createLaunchToolContext({
      ownerId,
      sessionId: "session",
      accounts: [{ ...account, ...invalid }],
      certified: ["outlook"],
      runtime: {},
    });
    assert.equal(c.tools.length, 0);
  }
});
async function routeFixture() {
  const calls = [];
  const service = {
    begin: async () => {
      calls.push("begin");
      return {};
    },
    execute: async () => {
      calls.push("read");
      return {};
    },
    complete: async () => {
      throw new ConnectorError("connector_not_certified", 503);
    },
    disconnect: async (input) => {
      calls.push(input);
      return { localDisconnected: true, providerRevoked: false };
    },
  };
  const deps = {
    createFileRoute: () => (v) => v,
    requireUser: async (request) =>
      request.headers.get("x-test-auth")
        ? { userId: ownerId, authProvider: "kova", claims: { session_id: "session" } }
        : new Response(null, { status: 401 }),
    readBoundedJsonObject,
    assertLaunchCertified,
    ConnectorError,
    isLaunchConnector,
    consumeApplicationRateLimit: async () => ({ allowed: true }),
    launchConnectorService: () => service,
    readOauthCookie: () => "nonce",
    serializeOauthCookie: () => "cookie",
  };
  const key = "__launch_route_test_" + Math.random().toString(36).slice(2);
  globalThis[key] = deps;
  const source = (
    await readFile(
      new URL("../../src/routes/api/integrations/launch/$connector.ts", import.meta.url),
      "utf8",
    )
  ).replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const compiled = ts.transpileModule(
    `const {${Object.keys(deps).join(",")}} = globalThis[${JSON.stringify(key)}];\n${source}`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const { Route } = await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
  );
  delete globalThis[key];
  const post = (body, auth = true) =>
    Route.server.handlers.POST({
      params: { connector: "outlook" },
      request: new Request("https://kova.example/api/integrations/launch/outlook", {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { "x-test-auth": "1" } : {}) },
        body: JSON.stringify(body),
      }),
    });
  return { calls, post, handlers: Route.server.handlers };
}
test("compiled HTTP route cannot bypass certification via request flags or credentials", async () => {
  const f = await routeFixture();
  for (const action of ["connect", "read"]) {
    const r = await f.post({
      action,
      accountId,
      operation: "list_messages",
      certified: true,
      available: true,
    });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "connector_not_certified" });
  }
  assert.deepEqual(f.calls, []);
});
test("compiled HTTP disconnect binds the authenticated owner and remains available inactive", async () => {
  const f = await routeFixture(),
    r = await f.post({ action: "disconnect", accountId, ownerId: "forged" });
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].ownerId, ownerId);
  assert.equal(f.calls[0].connector, "outlook");
  assert.ok(!(await r.text()).includes("ciphertext"));
});
test("HTTP rejects anonymous/oversized requests and clears failed OAuth cookies safely", async () => {
  const f = await routeFixture();
  assert.equal((await f.post({ action: "connect" }, false)).status, 401);
  assert.equal((await f.post({ action: "connect", extra: "x".repeat(33_000) })).status, 400);
  const r = await f.handlers.GET({
    params: { connector: "outlook" },
    request: new Request(
      "https://kova.example/api/integrations/launch/outlook?code=secret-code&state=secret-state",
    ),
  });
  assert.equal(r.status, 303);
  assert.ok(!r.headers.get("location").includes("secret"));
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
