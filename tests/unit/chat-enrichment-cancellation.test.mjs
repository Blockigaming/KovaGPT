import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { createChatPreflightRunner } from "../../src/lib/chat-preflight.server.mjs";
import { hashRateLimitIdentity } from "../../src/lib/distributed-rate-limit.mjs";
import { consumeOpenAiAdmission } from "../../src/lib/ai/openai-admission.server.mjs";
import { classifySearchProviderError } from "../../src/lib/ai/search-policy.mjs";

// Execute the real TypeScript modules with isolated, offline provider adapters.
function loadServerModule(path, dependencies, globals = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const context = {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected module dependency: ${name}`);
      return dependencies[name];
    },
    AbortController,
    Error,
    URL,
    setTimeout,
    clearTimeout,
    console: { warn() {} },
    ...globals,
  };
  vm.runInNewContext(compiled, context, { timeout: 1_000 });
  return exports;
}

function loadRetrieval(embeddings) {
  return loadServerModule("src/lib/project-rag.server.ts", {
    "@/lib/sanitize-text": {},
    "@/lib/ai/provider.server": {
      embeddingModel: () => "unit-test-embedding",
      embeddings,
      providerErrorFromResponse: () => new Error("mock_provider_error"),
    },
  }).retrieveProjectContext;
}

const embeddingResponse = () => ({
  ok: true,
  json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("a web-search deadline aborts both outstanding Firecrawl requests", async () => {
  const observedSignals = [];
  const { runWebSearch } = loadServerModule(
    "src/lib/ai/search.server.ts",
    {
      "@/lib/sanitize-text": { replaceControlCharacters: (value) => value },
      "@/lib/ai/search-policy.mjs": { classifySearchProviderError },
      "@/lib/ai/sources.server": {},
      "@/lib/runtime-env.server": {
        runtimeEnv: (name) => ({ FIRECRAWL_API_KEY: "offline-test-key" })[name],
      },
    },
    {
      process: { env: { FIRECRAWL_API_KEY: "offline-test-key" } },
      fetch(_url, init) {
        observedSignals.push(init.signal);
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      },
    },
  );
  const runner = createChatPreflightRunner({ optionalTimeoutMs: 20 });
  try {
    assert.equal(
      await runner.run("web_search", (signal) => runWebSearch("latest news", true, signal), {
        required: false,
      }),
      undefined,
    );
    assert.equal(observedSignals.length, 2);
    assert.ok(observedSignals.every((signal) => signal.aborted));
  } finally {
    runner.close();
  }
});

test("OpenAI search uses the durable daily contract before provider work", async () => {
  const admissions = [];
  let providerCalls = 0;
  const hashSecret = "test-only-rate-limit-secret-32-bytes-minimum";
  const startedAt = Math.floor(Date.now() / 86400000) * 86400000;
  const identityHash = await hashRateLimitIdentity(
    "openai_search_global",
    "openai_search_daily",
    hashSecret,
  );
  const { searchWeb } = loadServerModule("src/lib/ai/search.server.ts", {
    "@/lib/sanitize-text": { replaceControlCharacters: (value) => value },
    "@/lib/ai/search-policy.mjs": { classifySearchProviderError },
    "@/lib/ai/sources.server": {
      dedupeKovaSources: (sources) => sources,
      createCitationMap: () => [],
    },
    "@/lib/runtime-env.server": {
      runtimeEnv: (name) =>
        ({ KOVA_WEB_SEARCH_PROVIDER: "openai", KOVA_TEXT_PROVIDER: "openai" })[name],
    },
    "./openai-service-runtime.server": {
      openAiServices: () => ({
        search: async () => {
          providerCalls++;
          return {
            sources: [{ title: "Documentation", url: "https://developers.openai.com/docs" }],
            summary: "Current documentation",
          };
        },
      }),
    },
    "@/lib/ai/openai-admission-runtime.server": {
      consumeOpenAiApplicationAdmission: (input) =>
        consumeOpenAiAdmission({
          ...input,
          backendUrl: "https://project.supabase.co",
          serviceRoleKey: "test-service-role-key",
          hashSecret,
          fetchImpl: async (url, init) => {
            admissions.push({ url, method: init.method, body: JSON.parse(init.body) });
            return Response.json([
              {
                identity_hash: identityHash,
                action: "openai_search_daily",
                window_started_at: new Date(startedAt).toISOString(),
                request_count: 1,
                expires_at: new Date(startedAt + 2 * 86400000).toISOString(),
              },
            ]);
          },
        }),
    },
  });
  const result = await searchWeb("Use live web search for current docs", {
    requestId: "req_safe_1234",
  });
  assert.equal(result.status, "ok");
  assert.equal(providerCalls, 1);
  assert.equal(admissions.length, 1);
  assert.equal(new URL(admissions[0].url).pathname, "/rest/v1/diagnostic_rate_limits");
  assert.equal(admissions[0].method, "POST");
  assert.equal(admissions[0].body.action, "openai_search_daily");
  assert.equal(admissions[0].body.request_count, 1);
});

test("pre-aborted project retrieval starts neither embeddings nor a database request", async () => {
  let embeddings = 0;
  let databaseRequests = 0;
  const retrieve = loadRetrieval(async () => {
    embeddings++;
    return embeddingResponse();
  });
  const controller = new AbortController();
  controller.abort();
  const result = await retrieve({
    supabase: { rpc: () => databaseRequests++ },
    project_id: "project-1",
    query: "example",
    signal: controller.signal,
  });
  assert.equal(result.length, 0);
  assert.equal(embeddings, 0);
  assert.equal(databaseRequests, 0);
});

test("project preflight timeout aborts the embedding provider and prevents chunk matching", async () => {
  let observedSignal;
  let databaseRequests = 0;
  const retrieve = loadRetrieval((_body, init) => {
    observedSignal = init.signal;
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  });
  const runner = createChatPreflightRunner({ optionalTimeoutMs: 20 });
  try {
    const result = await runner.run(
      "project_retrieval",
      (signal) =>
        retrieve({
          supabase: { rpc: () => databaseRequests++ },
          project_id: "project-1",
          query: "example",
          signal,
        }),
      { required: false },
    );
    assert.equal(result, undefined);
    assert.equal(observedSignal.aborted, true);
    assert.equal(databaseRequests, 0);
  } finally {
    runner.close();
  }
});

test("a late embedding response cannot start chunk matching after its deadline", async () => {
  const response = deferred();
  let databaseRequests = 0;
  let pendingRetrieval;
  const retrieve = loadRetrieval(() => response.promise);
  const runner = createChatPreflightRunner({ optionalTimeoutMs: 20 });
  try {
    await runner.run(
      "project_retrieval",
      (signal) => {
        pendingRetrieval = retrieve({
          supabase: { rpc: () => databaseRequests++ },
          project_id: "project-1",
          query: "example",
          signal,
        });
        return pendingRetrieval;
      },
      { required: false },
    );
    response.resolve(embeddingResponse());
    assert.equal((await pendingRetrieval).length, 0);
    assert.equal(databaseRequests, 0);
  } finally {
    runner.close();
  }
});

test("project retrieval cancellation reaches an in-flight chunk matching RPC", async () => {
  const controller = new AbortController();
  const started = deferred();
  let observedSignal;
  const retrieve = loadRetrieval(async (_body, init) => {
    assert.equal(init.signal, controller.signal);
    return embeddingResponse();
  });
  const result = retrieve({
    supabase: {
      rpc(name, args) {
        assert.equal(name, "match_project_chunks");
        assert.equal(args._project_id, "project-1");
        return {
          abortSignal(signal) {
            observedSignal = signal;
            started.resolve();
            return new Promise((resolve) => {
              signal.addEventListener(
                "abort",
                () => resolve({ data: null, error: signal.reason }),
                {
                  once: true,
                },
              );
            });
          },
        };
      },
    },
    project_id: "project-1",
    query: "example",
    signal: controller.signal,
  });
  await started.promise;
  controller.abort();
  assert.equal((await result).length, 0);
  assert.equal(observedSignal, controller.signal);
  assert.equal(observedSignal.aborted, true);
});

test("successful project retrieval still returns project-scoped chunks without a signal", async () => {
  const chunks = [{ file_id: "file-1", content: "example", similarity: 0.9 }];
  const retrieve = loadRetrieval(async () => embeddingResponse());
  const result = await retrieve({
    supabase: {
      async rpc(name, args) {
        assert.equal(name, "match_project_chunks");
        assert.equal(args._project_id, "project-1");
        assert.equal(args.match_count, 6);
        return { data: chunks, error: null };
      },
    },
    project_id: "project-1",
    query: "example",
  });
  assert.equal(result, chunks);
});
