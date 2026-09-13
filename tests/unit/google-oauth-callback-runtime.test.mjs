import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      crypto,
      TextEncoder,
      Uint8Array,
      atob,
      URL,
      Response,
      Headers,
      process: {
        env: {
          SUPABASE_SERVICE_ROLE_KEY: "state-secret",
          GOOGLE_OAUTH_CLIENT_ID: "client",
          GOOGLE_OAUTH_CLIENT_SECRET: "secret",
          GOOGLE_REDIRECT_URI: "https://kova.test/api/google/callback",
        },
      },
      console: { error() {} },
      require(name) {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  return exports;
}
async function callbackRequest() {
  const user = "11111111-1111-4111-8111-111111111111",
    attempt = crypto.randomUUID(),
    payload = `${user}.${attempt}.${Date.now()}`,
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("state-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  const sig = Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ).toString("base64url"),
    state = `${payload}.${sig}`;
  return {
    user,
    attempt,
    request: new Request(`https://kova.test/api/google/callback?code=code&state=${state}`, {
      headers: { cookie: `__Host-kova_google_oauth=${state}.verifier` },
    }),
  };
}
function handler(finish, allow = async () => {}) {
  return load("src/routes/api/google/callback.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/google-oauth.server": { finishGoogleOAuth: finish, logAudit: async () => {} },
    "@/integrations/supabase/client.server": { supabaseAdmin: {} },
    "@/lib/lockdown-policy.mjs": { assertLockdownAllows: allow },
  }).Route.server.handlers.GET;
}
test("actual Google callback binds authenticated state and cookie to the claimed settlement flow", async () => {
  const input = await callbackRequest(),
    calls = [];
  const boundaries = [];
  const response = await handler(
    async (...args) => {
      boundaries.push("settlement");
      calls.push(args);
    },
    async (_client, userId, capability) => {
      assert.equal(userId, input.user);
      assert.equal(capability, "connector_write");
      boundaries.push("lockdown");
    },
  )({ request: input.request });
  assert.deepEqual(boundaries, ["lockdown", "settlement"]);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("google_connected"), "1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], input.user);
  assert.equal(calls[0][1], input.attempt);
  assert.equal(calls[0][2], "code");
  assert.equal(calls[0][4], "verifier");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
test("invalid callback cookie and Lockdown never reach credential exchange; settlement rejection is safely bounced", async () => {
  const input = await callbackRequest();
  let calls = 0;
  const fn = handler(async () => {
    calls++;
    throw Error("google_connection_changed");
  });
  const missing = new Request(input.request.url);
  assert.equal(
    new URL((await fn({ request: missing })).headers.get("location")).searchParams.get(
      "google_error",
    ),
    "invalid_state",
  );
  assert.equal(calls, 0);
  await handler(
    async () => calls++,
    async () => {
      throw Error("lockdown");
    },
  )({ request: input.request });
  assert.equal(calls, 0);
  const rejected = await fn({ request: input.request });
  assert.equal(
    new URL(rejected.headers.get("location")).searchParams.get("google_error"),
    "exchange_failed",
  );
  assert.equal(calls, 1);
});
test("Google OAuth cleanup endpoint is opt-in and accepts no caller-selected receipt or payload", async () => {
  let calls = 0;
  const fn = (secret) =>
    load("src/routes/api/internal/google-oauth-cleanup.ts", {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/http-security.server": { timingSafeEqualText: (a, b) => a === b },
      "@/lib/runtime-env.server": { runtimeEnv: () => secret },
      "@/lib/google-oauth.server": {
        runGoogleOAuthCleanup: async () => {
          calls++;
          return { processed: 1 };
        },
      },
    }).Route.server.handlers.POST;
  const request = (suffix = "", token = "secret") =>
    new Request(`https://kova.test/api/internal/google-oauth-cleanup${suffix}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await fn(undefined)({ request: request() })).status, 503);
  assert.equal((await fn("secret")({ request: request("", "wrong") })).status, 401);
  assert.equal((await fn("secret")({ request: request("?receipt=private") })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await fn("secret")({ request: request() })).status, 200);
  assert.equal(calls, 1);
});
