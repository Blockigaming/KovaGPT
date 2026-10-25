import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as auth from "../../src/lib/kova-email-worker-auth.server.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
const secret = "synthetic-dedicated-email-worker-secret";
const source = ts.transpileModule(
  readFileSync("src/routes/api/internal/email-dispatch.ts", "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
function fixture({ enabled = true, failure = false, publicOrigin = "https://kovagpt.com" } = {}) {
  const calls = [],
    exports = {};
  const modules = {
    "@tanstack/react-router": {
      createFileRoute: (path) => {
        assert.equal(path, "/api/internal/email-dispatch");
        return (value) => value;
      },
    },
    "@/lib/kova-email-worker-auth.server.mjs": {
      authenticateEmailWorkerRequest: (request) =>
        auth.authenticateEmailWorkerRequest(request, { KOVA_EMAIL_WORKER_SECRET: secret }),
    },
    "@/lib/kova-email-worker.server.mjs": {
      productionEmailWorkerConfiguration: () => {
        if (!enabled) throw new Error("private config");
        return { publicOrigin };
      },
      runProductionEmailWorker: async (run) => {
        calls.push(run);
        if (failure) throw new Error("private-key-and-provider-content");
        return { claimed: true, attempted: 0, auth: null, account: null };
      },
    },
    "@/lib/endpoint-reliability.mjs": reliability,
  };
  vm.runInNewContext(source, {
    exports,
    URL,
    Response,
    Error,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name));
      return modules[name];
    },
  });
  return { calls, handle: (request) => exports.Route.server.handlers.POST({ request }) };
}
function request({ body = "{}", origin = "https://kovagpt.com", signature = true } = {}) {
  const run = { runId: "10000000-0000-4000-8000-000000000001", issuedAt: new Date().toISOString() };
  return new Request(`${origin}/api/internal/email-dispatch`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Kova-Email-Run-Id": run.runId,
      "X-Kova-Email-Issued-At": run.issuedAt,
      "X-Kova-Email-Signature": signature
        ? auth.signEmailWorkerRequest(run, secret)
        : "0".repeat(64),
    },
  });
}
test("only a valid signed exact production request with fixed {} body reaches worker", async () => {
  const f = fixture();
  const response = await f.handle(request());
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  for (const options of [
    { body: '{"recipient":"other@example.test"}' },
    { body: " {}" },
    { body: "[]" },
    { body: "" },
    { origin: "https://www.kovagpt.com" },
    { signature: false },
  ]) {
    const rejected = await f.handle(request(options));
    assert.equal(rejected.status, 401);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(await rejected.json(), { ok: false, error: "unauthorized" });
  }
});
test("disabled configuration and uncertain worker return safe errors without raw content", async () => {
  const disabled = fixture({ enabled: false });
  assert.equal((await disabled.handle(request())).status, 503);
  assert.equal(disabled.calls.length, 0);
  const f = fixture({ failure: true });
  const response = await f.handle(request());
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await response.json(), { ok: false, error: "email_worker_pending" });
});

test("a direct Azure worker endpoint accepts only its configured exact origin", async () => {
  const origin = "https://kovagpt-prod-web.review.eastus.azurecontainerapps.io";
  const f = fixture({ publicOrigin: origin });
  assert.equal((await f.handle(request({ origin }))).status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.handle(request())).status, 401);
  assert.equal((await f.handle(request({ origin, signature: false }))).status, 401);
  assert.equal(f.calls.length, 1);
});
