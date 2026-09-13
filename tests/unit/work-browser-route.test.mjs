import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as protocol from "../../src/lib/work-execution-protocol.mjs";
import * as policy from "../../src/lib/work-browser-policy.mjs";
import * as bodyReader from "../../src/lib/bounded-json.server.mjs";
import * as authSecurity from "../../src/lib/auth-security.mjs";
const owner = crypto.randomUUID(),
  runId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  runner = crypto.randomUUID();
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in modules)) throw Error(name);
        return modules[name];
      },
      crypto,
      Date,
      Error,
      Math,
      Number,
      Object,
      Array,
      JSON,
      URL,
      Response,
      Request,
      Headers,
      AbortController,
      AbortSignal,
      TextEncoder,
      TextDecoder,
      structuredClone,
    },
  );
  return exports;
}
function fixture() {
  const calls = [];
  let entitlement = true,
    confirmed = true;
  const row = {
    id: runId,
    ownerId: owner,
    runnerId: runner,
    runnerBuild: "a".repeat(40),
    revision: 3,
    status: "paused",
  };
  const db = {
    rpc(name, input) {
      calls.push({ name, input });
      return {
        abortSignal: async () => ({
          data:
            name === "finish_work_browser_owner"
              ? true
              : { sessionId, runId, sequence: 2, expiresAt: Date.now() + 60000 },
          error: null,
        }),
      };
    },
  };
  const caller = { userId: owner, supabaseAdmin: db };
  const server = load("src/lib/work-browser.server.ts", {
    "@/lib/work-execution.server": {
      getWorkExecution: async (_, id) => {
        calls.push({ name: "getRun" });
        assert.equal(id, runId);
        return row;
      },
      createWorkExecutionRepository: () => ({
        authorize: async () => {
          calls.push({ name: "entitlement" });
          if (!entitlement) throw Error("model unavailable");
        },
      }),
    },
    "@/lib/work-runner.server": {
      workRunnerConfiguration: () => ({ id: runner, build: row.runnerBuild }),
    },
    "@/lib/work-browser-transport.mjs": {
      browserRunnerCapabilities: async () => ({
        available: true,
        protocol: "kova-browser-v1",
        maxSessionSeconds: 300,
        origins: ["https://browser-fixture.net"],
      }),
      browserRunnerCommand: async (_, command) => {
        calls.push({ name: "transport", command });
        return { sessionId, runId, sequence: 2, closed: command.operation === "close" };
      },
    },
    "@/lib/work-execution-protocol.mjs": protocol,
    "@/lib/work-browser-policy.mjs": policy,
  });
  const route = load("src/routes/api/work/browser.ts", {
    "@tanstack/react-router": { createFileRoute: () => () => ({}) },
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () => (confirmed ? caller : new Response(null, { status: 401 })),
    },
    "@/lib/auth-security.mjs": authSecurity,
    "@/lib/bounded-json.server.mjs": bodyReader,
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/work-browser.server": server,
  });
  const input = {
    expectedUserId: owner,
    runId,
    sessionId,
    expectedRevision: 3,
    expectedSequence: 1,
    operation: "snapshot",
  };
  const request = (body = input, headers = {}) =>
    new Request("https://app-fixture.net/api/work/browser", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app-fixture.net",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return {
    calls,
    route,
    server,
    input,
    request,
    loseEntitlement: () => (entitlement = false),
    signOut: () => (confirmed = false),
  };
}
test("actual route rejects another principal before reading a run or moving a browser", async () => {
  const f = fixture();
  const response = await f.route.handleWorkBrowser(
    f.request({ ...f.input, expectedUserId: crypto.randomUUID() }),
  );
  assert.equal(response.status, 409);
  assert.equal(f.calls.length, 0);
  const read = await f.route.handleWorkBrowser(
    new Request(
      `https://app-fixture.net/api/work/browser?runId=${runId}&expectedUserId=${crypto.randomUUID()}`,
    ),
  );
  assert.equal(read.status, 409);
  assert.equal(f.calls.length, 0);
});
test("actual route blocks cross-site, unsigned, oversized and unknown-field private commands", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.handleWorkBrowser(
        f.request(f.input, { origin: "https://attacker.net", "sec-fetch-site": "cross-site" }),
      )
    ).status,
    403,
  );
  assert.notEqual(
    (await f.route.handleWorkBrowser(f.request({ ...f.input, text: "x".repeat(13000) }))).status,
    200,
  );
  assert.equal(
    (await f.route.handleWorkBrowser(f.request({ ...f.input, operatorToken: "no" }))).status,
    400,
  );
  assert.equal(f.calls.length, 0);
  f.signOut();
  assert.equal((await f.route.handleWorkBrowser(f.request())).status, 401);
});
test("actual server mints a sequence after exact revision admission, then finishes only the acknowledged tuple", async () => {
  const f = fixture();
  const response = await f.route.handleWorkBrowser(f.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const admission = f.calls.find((v) => v.name === "admit_work_browser_owner");
  assert.equal(admission.input.p_owner, owner);
  assert.equal(admission.input.p_run_revision, 3);
  assert.equal(admission.input.p_sequence, 1);
  const sent = f.calls.find((v) => v.name === "transport").command;
  assert.equal(sent.sequence, 2);
  assert.equal(sent.ownerId, owner);
  assert.ok(!("expectedRevision" in sent));
  assert.equal(f.calls.at(-1).name, "finish_work_browser_owner");
});
test("an owner can revoke an existing browser after model entitlement is lost", async () => {
  const f = fixture();
  f.loseEntitlement();
  assert.equal((await f.route.handleWorkBrowser(f.request())).status, 503);
  f.calls.length = 0;
  assert.equal(
    (await f.route.handleWorkBrowser(f.request({ ...f.input, operation: "close" }))).status,
    200,
  );
  assert.ok(!f.calls.some((v) => v.name === "entitlement"));
  assert.equal(f.calls.find((v) => v.name === "transport").command.operation, "close");
});
test("owner input policy matches fixed runner key and scroll bounds", () => {
  const f = fixture();
  assert.throws(() =>
    policy.parseBrowserOwnerInput({ ...f.input, operation: "scroll", delta: 901 }),
  );
  assert.equal(
    policy.parseBrowserOwnerInput({ ...f.input, operation: "scroll", delta: 900 }).delta,
    900,
  );
  assert.throws(() =>
    policy.parseBrowserOwnerInput({
      ...f.input,
      operation: "press",
      view: crypto.randomUUID(),
      target: crypto.randomUUID(),
      key: "Backspace",
    }),
  );
  assert.equal(
    policy.parseBrowserOwnerInput({
      ...f.input,
      operation: "press",
      view: crypto.randomUUID(),
      target: crypto.randomUUID(),
      key: "Space",
    }).key,
    "Space",
  );
});
