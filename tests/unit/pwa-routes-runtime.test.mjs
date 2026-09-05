import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name === "@tanstack/react-router") return { createFileRoute: () => (value) => value };
        assert.ok(name in deps, name);
        return deps[name];
      },
      Response,
      URL,
      TextDecoder,
      AbortSignal,
    },
  );
  return exports.Route.server.handlers;
}
test("push management authenticates and pins the rendered owner before any service write; remote revoke retains exact revision", async () => {
  const calls = [];
  const handlers = load("src/routes/api/push.ts", {
    zod: { z },
    "@/lib/api-auth.server": { requireVerifiedUser: async () => ({ userId: owner }) },
    "@/lib/http-security.server": {
      rejectCrossSiteRequest: (request) =>
        request.headers.get("sec-fetch-site") === "cross-site"
          ? new Response(null, { status: 403 })
          : null,
    },
    "@/lib/endpoint-reliability.mjs": { readResponseBytesBounded },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/pwa/push.server": {
      pushStatus: async (...args) => {
        calls.push(["status", ...args]);
        return { ready: false };
      },
      subscribePush: async (...args) => calls.push(["subscribe", ...args]),
      pushRpc: async (...args) => calls.push(["rpc", ...args]),
      setPushQuietHours: async (...args) => calls.push(["preferences", ...args]),
    },
  });
  const post = (body, site = "same-origin") =>
    handlers.POST({
      request: new Request("https://kova.test/api/push", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": site },
        body: JSON.stringify(body),
      }),
    });
  assert.equal(
    (
      await handlers.GET({
        request: new Request(`https://kova.test/api/push?expectedUserId=${other}`),
      })
    ).status,
    409,
  );
  const data = { action: "revoke", id: other, expectedRevision: 7, expectedUserId: owner };
  assert.equal((await post({ ...data, expectedUserId: other })).status, 409);
  assert.equal((await post(data, "cross-site")).status, 403);
  assert.equal((await post({ ...data, force: true })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post(data)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["rpc", owner, "revoke", { id: other, expectedRevision: 7 }],
  ]);
});
test("push delivery endpoint is disabled without its dedicated secret and rejects arguments or unauthenticated dispatch", async () => {
  let count = 0;
  const handlers = (secret) =>
    load("src/routes/api/internal/web-push.ts", {
      "@/lib/runtime-env.server": { runtimeEnv: () => secret },
      "@/lib/http-security.server": { timingSafeEqualText: (a, b) => a === b },
      "@/lib/pwa/push.server": {
        runWebPushBatch: async () => {
          count++;
          return { processed: 0 };
        },
      },
    });
  const request = (suffix = "", token = "worker") =>
    new Request(`https://kova.test/api/internal/web-push${suffix}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await handlers(null).POST({ request: request() })).status, 503);
  assert.equal((await handlers("worker").POST({ request: request("", "wrong") })).status, 401);
  assert.equal((await handlers("worker").POST({ request: request("?owner=someone") })).status, 400);
  assert.equal(count, 0);
  assert.equal((await handlers("worker").POST({ request: request() })).status, 200);
  assert.equal(count, 1);
});
