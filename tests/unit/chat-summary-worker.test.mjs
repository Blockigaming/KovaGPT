import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as summaryPolicy from "../../src/lib/chat-summary-policy.server.mjs";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      AbortSignal,
      Response,
      URL,
      console: { error: () => undefined },
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
  );
  return exports;
}

function worker({
  enabled,
  rpc,
  generate = () => {
    throw new Error("Unexpected provider work");
  },
}) {
  return load("src/lib/chat-summary.server.ts", {
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        rpc: (name, args) => ({
          abortSignal: (signal) => {
            assert.equal(signal.aborted, false);
            return rpc(name, args);
          },
        }),
      },
    },
    "@/lib/runtime-env.server": {
      runtimeEnv: (name) =>
        name === "KOVA_CHAT_SUMMARIES_ENABLED" ? String(enabled) : "worker-secret",
    },
    "@/lib/ai/provider.server": { chatCompletions: generate },
    "@/lib/ai/model-router.server": { modelForRole: () => "test-utility" },
    "@/lib/ai/model-config.mjs": { UTILITY_MAX_OUTPUT_TOKENS: 2000 },
    "@/lib/provider-response.server.mjs": { readProviderJsonObject: (response) => response.json() },
    "@/lib/chat-summary-policy.server.mjs": summaryPolicy,
  });
}

test("disabled generation still runs retention cleanup without claiming or calling the provider", async () => {
  const calls = [];
  const { runChatSummaryBatch } = worker({
    enabled: false,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: 3 };
    },
  });
  const result = await runChatSummaryBatch();
  assert.deepEqual(
    calls.map(([name]) => name),
    ["purge_expired_chat_context_inputs"],
  );
  assert.equal(result.purged, 3);
  assert.equal(result.claimed, 0);
  assert.equal(result.completed, 0);
});

test("retention errors stop an enabled batch before any provider admission", async () => {
  for (const result of [{ data: null, error: "offline" }, { data: 501 }, { data: -1 }]) {
    const calls = [];
    const { runChatSummaryBatch } = worker({
      enabled: true,
      rpc: async (name) => {
        calls.push(name);
        return result;
      },
    });
    await assert.rejects(runChatSummaryBatch(), /cleanup_unavailable/);
    assert.deepEqual(calls, ["purge_expired_chat_context_inputs"]);
  }
});

test("the worker authenticates before cleanup and rejects caller-selected work arguments", async () => {
  let calls = 0;
  const handler = (secret) =>
    load("src/routes/api/internal/chat-summaries.ts", {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/http-security.server": { timingSafeEqualText: (left, right) => left === right },
      "@/lib/runtime-env.server": { runtimeEnv: () => secret },
      "@/lib/chat-summary.server": {
        runChatSummaryBatch: async () => {
          calls++;
          return { purged: 1 };
        },
      },
    }).Route.server.handlers.POST;
  for (const [secret, token, status] of [
    [undefined, "", 503],
    ["expected", "", 401],
    ["expected", "wrong", 401],
  ]) {
    const response = await handler(secret)({
      request: new Request("https://kova.test/api/internal/chat-summaries", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const [suffix, body] of [
    ["?limit=100", undefined],
    ["", "{}"],
  ]) {
    const response = await handler("expected")({
      request: new Request(`https://kova.test/api/internal/chat-summaries${suffix}`, {
        method: "POST",
        headers: { authorization: "Bearer expected" },
        body,
      }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  const response = await handler("expected")({
    request: new Request("https://kova.test/api/internal/chat-summaries", {
      method: "POST",
      headers: { authorization: "Bearer expected" },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
