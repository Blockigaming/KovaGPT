import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      Response,
      URL,
      require: (name) => {
        assert.ok(name in deps, `Unexpected import ${name}`);
        return deps[name];
      },
    },
  );
  return exports.Route.server.handlers.POST;
}
function worker({
  secret = "secret",
  enabled = true,
  allowed = true,
  run = async () => ({ claimed: 0 }),
} = {}) {
  return load("src/routes/api/internal/workspace-search.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/http-security.server": { timingSafeEqualText: (a, b) => a === b },
    "@/lib/runtime-env.server": { runtimeEnv: () => secret },
    "@/integrations/supabase/client.server": { supabaseAdmin: {} },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed, status: "limited" }),
    },
    "@/lib/workspace-search-policy.server.mjs": { processWorkspaceSearchJobs: run },
    "@/lib/workspace-search.server": {
      workspaceSemanticEnabled: () => enabled,
      workspaceEmbeddingModel: () => "m",
      workspaceRpc: () => {},
      embedWorkspaceText: () => {},
    },
  });
}
test("workspace worker rejects configuration, secrets, custom input, and exhausted budgets before any provider work", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
  };
  for (const [options, init, url, expected] of [
    [{ secret: "" }, {}, "", 503],
    [{ enabled: false }, {}, "", 503],
    [{}, {}, "", 401],
    [{}, { headers: { authorization: "Bearer wrong" } }, "", 401],
    [{}, { headers: { authorization: "Bearer secret" }, body: "{}" }, "", 400],
    [{}, { headers: { authorization: "Bearer secret" } }, "?limit=100", 400],
    [{ allowed: false }, { headers: { authorization: "Bearer secret" } }, "", 429],
  ]) {
    const response = await worker({ ...options, run })({
      request: new Request(`https://kova.test/api/internal/workspace-search${url}`, {
        method: "POST",
        ...init,
      }),
    });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});
test("workspace search binds results to the caller RLS client, bounds query input, and skips embeddings when the daily budget is exhausted", async () => {
  const client = { name: "caller-RLS" };
  let searched;
  let calls = 0;
  const handler = load("src/routes/api/workspace/search.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/api-auth.server": {
      requireUser: async () => ({
        userId: "owner",
        supabaseUser: client,
        supabaseAdmin: { name: "admin must not read" },
      }),
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async (input) => ({
        allowed: input.action === "workspace_search",
        status: "limited",
      }),
    },
    "@/lib/endpoint-reliability.mjs": { readUtf8BodyBounded: async (request) => request.text() },
    "@/lib/auth-security.mjs": { isCrossSiteMutation: () => false },
    "@/lib/workspace-search-policy.server.mjs": {
      searchWorkspace: async (input) => {
        calls++;
        searched = input;
        return { mode: "keyword", items: [] };
      },
    },
    "@/lib/workspace-search.server": {
      workspaceSemanticEnabled: () => true,
      workspaceEmbeddingModel: () => "m",
      workspaceRpc: (actual) => {
        assert.equal(actual, client);
        return () => {};
      },
      embedWorkspaceText: () => {},
    },
  });
  const invoke = (query) =>
    handler({
      request: new Request("https://kova.test/api/workspace/search", {
        method: "POST",
        body: JSON.stringify({ query }),
        headers: { "content-type": "application/json" },
      }),
    });
  assert.equal((await invoke("a")).status, 400);
  assert.equal((await invoke("x".repeat(501))).status, 400);
  assert.equal(calls, 0);
  const response = await invoke(" launch plan ");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(searched.query, "launch plan");
  assert.equal(searched.semanticAllowed, false);
});
