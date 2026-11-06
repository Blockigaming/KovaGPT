import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { consumeDistributedRateLimit } from "../../src/lib/distributed-rate-limit.mjs";
import * as runnerTransport from "../../src/lib/work-runner-transport.mjs";
import * as browserTransport from "../../src/lib/work-browser-transport.mjs";
import * as protocol from "../../src/lib/work-execution-protocol.mjs";
import { readUtf8BodyBounded } from "../../src/lib/endpoint-reliability.mjs";

const globals = { Response, Request, Headers, URL, TextEncoder, Date };
const httpSecurity = loadUiModule("src/lib/http-security.server.ts", {}, globals);
const configuration = {
  enabled: true,
  origin: "https://runner-fixture.net",
  id: crypto.randomUUID(),
  build: "a".repeat(40),
  token: "t".repeat(64),
  signingKey: "s".repeat(64),
};

function fixture(kind, outcome = "allowed") {
  const rateRequests = [];
  let protectedReads = 0;
  const database = {
    from: () => ({
      select: () => ({
        limit: async () => {
          protectedReads++;
          return { data: [], error: null };
        },
      }),
    }),
  };
  const ownerId = crypto.randomUUID();
  const module = loadUiModule(
    `src/routes/api/internal/work-${kind}.ts`,
    {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/account-identity.server.mjs": { readAccountIdentity: async () => ({ id: ownerId }) },
      "@supabase/supabase-js": { createClient: () => ({}) },
      "@/integrations/supabase/client.server": { supabaseAdmin: database },
      "@/lib/http-security.server": httpSecurity,
      "@/lib/runtime-env.server": { runtimeEnv: () => "fixture" },
      "@/lib/endpoint-reliability.mjs": { readUtf8BodyBounded },
      "@/lib/work-runner.server": { workRunnerConfiguration: () => configuration },
      "@/lib/work-runner-transport.mjs": runnerTransport,
      "@/lib/work-browser-transport.mjs": browserTransport,
      "@/lib/work-execution-protocol.mjs": protocol,
      "@/lib/work-execution-database.server": { workExecutionDatabase: () => database },
      "@/lib/work-execution-driver.server": {},
      "@/lib/work-browser.server": {
        authorizeWorkBrowser: async () => {
          protectedReads++;
          return { allowed: true };
        },
      },
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: (input) =>
          consumeDistributedRateLimit({
            ...input,
            backendUrl: "https://backend-fixture.net",
            serviceRoleKey: "offline-service-role",
            hashSecret: "h".repeat(64),
            fetchImpl: async (_, init) => {
              rateRequests.push(JSON.parse(init.body));
              if (outcome === "unavailable") throw new Error("offline");
              return Response.json([{ allowed: outcome === "allowed", retry_after: 60 }]);
            },
          }),
      },
    },
    globals,
  );
  return {
    rateRequests,
    protectedReads: () => protectedReads,
    async send({ badToken = false, badSignature = false } = {}) {
      const body = protocol.canonicalWorkInput({
        protocol: protocol.WORK_EXECUTION_PROTOCOL,
        runnerId: configuration.id,
        build: configuration.build,
        requestId: crypto.randomUUID(),
        at: Date.now(),
        operation: kind === "execution" ? "probe" : "browser_authorize",
        payload:
          kind === "execution"
            ? {}
            : {
                phase: "check",
                actor: "owner",
                ownerId,
                runId: crypto.randomUUID(),
                sessionId: crypto.randomUUID(),
                sequence: 1,
              },
      });
      const signature = await runnerTransport.signRunnerEnvelope(
        configuration.signingKey,
        "request",
        body,
      );
      const request = new Request(`https://app-fixture.net/api/internal/work-${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${badToken ? "x".repeat(64) : configuration.token}`,
          "X-Kova-Signature": badSignature ? "0".repeat(64) : signature,
        },
        body,
      });
      return module.Route.server.handlers.POST({ request });
    },
  };
}

for (const kind of ["execution", "browser"]) {
  for (const [outcome, status] of [
    ["allowed", 200],
    ["limited", 429],
    ["unavailable", 503],
  ]) {
    test(`signed Work ${kind} callback uses the real limiter contract: ${outcome}`, async () => {
      const f = fixture(kind, outcome);
      const response = await f.send();
      assert.equal(response.status, status);
      assert.equal(f.rateRequests.length, 1);
      assert.equal(f.protectedReads(), outcome === "allowed" ? 1 : 0);
      if (status === 200 && kind === "execution")
        assert.equal((await response.json()).status, "ready");
    });
  }
  for (const failure of ["badToken", "badSignature"]) {
    test(`Work ${kind} rejects ${failure} before consuming a rate bucket`, async () => {
      const f = fixture(kind);
      const response = await f.send({ [failure]: true });
      assert.equal(response.status, failure === "badToken" || kind === "execution" ? 401 : 403);
      assert.equal(f.rateRequests.length, 0);
      assert.equal(f.protectedReads(), 0);
    });
  }
}

for (const [outcome, status] of [
  ["allowed", 200],
  ["limited", 429],
  ["unavailable", 503],
]) {
  test(`Work execution readiness uses the real limiter contract: ${outcome}`, async () => {
    const rateRequests = [];
    let protectedReads = 0;
    const module = loadUiModule(
      "src/routes/api/work/execution.ts",
      {
        "@tanstack/react-router": { createFileRoute: () => (options) => options },
        "@/lib/api-auth.server": { requireUser: async () => ({ userId: "owner-fixture" }) },
        "@/lib/auth-security.mjs": {},
        "@/lib/bounded-json.server.mjs": {},
        "@/agents/execution.server": {},
        "@/lib/kova-work-submission.mjs": {},
        "@/lib/work-execution.server": {
          workExecutionReadiness: async () => {
            protectedReads++;
            return { available: true };
          },
        },
        "@/lib/distributed-rate-limit.server": {
          consumeApplicationRateLimit: (input) =>
            consumeDistributedRateLimit({
              ...input,
              backendUrl: "https://backend-fixture.net",
              serviceRoleKey: "offline-service-role",
              hashSecret: "h".repeat(64),
              fetchImpl: async (_, init) => {
                rateRequests.push(JSON.parse(init.body));
                if (outcome === "unavailable") throw new Error("offline");
                return Response.json([{ allowed: outcome === "allowed", retry_after: 60 }]);
              },
            }),
        },
      },
      globals,
    );
    const response = await module.Route.server.handlers.GET({
      request: new Request("https://app-fixture.net/api/work/execution?readiness=true"),
    });
    assert.equal(response.status, status);
    assert.equal(rateRequests.length, 1);
    assert.equal(protectedReads, outcome === "allowed" ? 1 : 0);
    if (status === 200) assert.equal((await response.json()).readiness.available, true);
  });
}
