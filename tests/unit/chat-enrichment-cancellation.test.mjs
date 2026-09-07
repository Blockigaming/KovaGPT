import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { createChatPreflightRunner } from "../../src/lib/chat-preflight.server.mjs";

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

test("chat enrichment forwards each preflight signal to the actual operation", () => {
  const chat = readFileSync("src/routes/api/chat.ts", "utf8");
  assert.match(
    chat,
    /"web_search",\s*async\s*\(signal\)\s*=>\s*\{[\s\S]{0,400}?\breturn\s+runWebSearch\(\s*lastText,\s*clientTool === "deep_research" \|\| NEWS_TRIGGER\.test\(lastText\),\s*signal,\s*\);/u,
  );
  assert.match(
    chat,
    /"project_retrieval",\s*\(signal\) =>\s*retrieveProjectContext\(\{[^}]+\bsignal,/u,
  );
});

test("a web-search deadline aborts both outstanding Firecrawl requests", async () => {
  const observedSignals = [];
  const { runWebSearch } = loadServerModule(
    "src/lib/ai/search.server.ts",
    {
      "@/lib/sanitize-text": { replaceControlCharacters: (value) => value },
      "@/lib/ai/sources.server": {},
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
