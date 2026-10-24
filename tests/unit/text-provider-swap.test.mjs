import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/endpoint-reliability.mjs";
function loadProvider(env, fetcher, generationEnabled = true) {
  const output = ts.transpileModule(fs.readFileSync("src/lib/ai/provider.server.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const logs = [],
    meters = [],
    exports = {};
  const modules = {
    "@/lib/endpoint-reliability.mjs": bounded,
    "@/lib/runtime-env.server": { runtimeEnv: (key) => env[key] },
    "@/lib/pricing/developer-billing.server": {
      meterProviderRequest: async (input) => {
        meters.push(input);
        return input.send();
      },
    },
    "@/lib/ai/responses-compat.server.mjs": {},
    "@/lib/ai/config.server": { getAiRuntimeConfig: () => ({ generationEnabled }) },
    "@/lib/ai/model-catalog.server": {
      modelForPolicy: (policy) => ({
        id:
          policy === "deep"
            ? "gpt-5.6-sol"
            : policy === "thinking"
              ? "gpt-5.6-terra"
              : "gpt-5.6-luna",
      }),
      maximumServerOutputForModel: () => 4096,
    },
    "@/lib/ai/provider-transport.server.mjs": transport,
  };
  new Function("exports", "require", "fetch", "console", output)(
    exports,
    (key) => {
      assert.ok(modules[key], key);
      return modules[key];
    },
    fetcher,
    {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  );
  return { ...exports, logs, meters };
}

const azure = {
  AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
  AZURE_OPENAI_API_KEY: "azure-fixture",
  OPENAI_API_KEY: "openai-fixture",
};
test("default selection preserves Azure and direct OpenAI routing", () => {
  assert.equal(loadProvider(azure).getAiProviderConfig().provider, "azure_openai");
  assert.equal(
    loadProvider({ OPENAI_API_KEY: "fixture" }).getAiProviderConfig().provider,
    "openai",
  );
});
test("explicit OpenAI bypasses stale Azure settings and retains native model IDs", async () => {
  let call;
  const api = loadProvider(
    {
      ...azure,
      KOVA_TEXT_PROVIDER: "openai",
      AZURE_OPENAI_ENDPOINT: "invalid-old-endpoint",
      AZURE_OPENAI_DEPLOYMENT_CHAT: "old-alias",
    },
    async (url, init) => {
      call = { url, init };
      return new Response("{}");
    },
  );
  await (await api.developerResponses({ model: "gpt-5.6-luna", input: "fixture" })).text();
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(call.init.headers.get("authorization"), "Bearer openai-fixture");
  assert.equal(call.init.headers.has("api-key"), false);
  assert.equal(JSON.parse(call.init.body).model, "gpt-5.6-luna");
  assert.equal(api.meters.length, 1);
  assert.doesNotMatch(JSON.stringify(api.logs), /openai-fixture|azure-fixture/);
});
test("explicit Azure restores deployment mapping and Azure authentication", async () => {
  let call;
  const api = loadProvider(
    {
      ...azure,
      KOVA_TEXT_PROVIDER: "azure_openai",
      AZURE_OPENAI_DEPLOYMENT_CHAT: "approved-chat-alias",
    },
    async (url, init) => {
      call = { url, init };
      return new Response("{}");
    },
  );
  await (await api.developerResponses({ model: "gpt-5.6-luna", input: "fixture" })).text();
  assert.equal(call.url, "https://fixture.openai.azure.com/openai/v1/responses");
  assert.equal(call.init.headers.get("api-key"), "azure-fixture");
  assert.equal(call.init.headers.has("authorization"), false);
  assert.equal(JSON.parse(call.init.body).model, "approved-chat-alias");
});
test("missing selected credentials or endpoint never falls back", async () => {
  let calls = 0;
  for (const env of [
    {
      KOVA_TEXT_PROVIDER: "openai",
      AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: "fixture",
    },
    { KOVA_TEXT_PROVIDER: "azure_openai", OPENAI_API_KEY: "fixture" },
    {
      KOVA_TEXT_PROVIDER: "azure_openai",
      AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
      OPENAI_API_KEY: "fixture",
    },
    { ...azure, KOVA_TEXT_PROVIDER: "typo-private-value" },
  ]) {
    const api = loadProvider(env, async () => {
      calls++;
      return new Response("{}");
    });
    const failure = api.validateAiProviderConfig();
    assert.equal(failure.status, 503);
    assert.equal(failure.retryable, false);
    assert.doesNotMatch(JSON.stringify(failure), /typo-private-value|fixture/);
    await assert.rejects(api.developerResponses({ model: "gpt-5.6-luna" }));
  }
  assert.equal(calls, 0);
});
test("provider switch cannot override disabled generation", async () => {
  let calls = 0;
  const api = loadProvider(
    { ...azure, KOVA_TEXT_PROVIDER: "openai" },
    async () => {
      calls++;
      return new Response("{}");
    },
    false,
  );
  await assert.rejects(api.developerResponses({ model: "gpt-5.6-luna" }));
  assert.equal(calls, 0);
});
test("text selection does not move image or embedding traffic from Azure", async () => {
  const calls = [];
  const api = loadProvider(
    {
      ...azure,
      KOVA_TEXT_PROVIDER: "openai",
      AZURE_OPENAI_DEPLOYMENT_IMAGE: "image-alias",
      AZURE_OPENAI_DEPLOYMENT_EMBEDDING: "embedding-alias",
    },
    async (url, init) => {
      calls.push({ url, init });
      return new Response('{"data":[]}');
    },
  );
  await api.imageGenerations({ model: "gpt-image-1", prompt: "fixture" });
  await api.embeddings({ model: "text-embedding-3-small", input: "fixture" });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.match(c.url, /^https:\/\/fixture\.openai\.azure\.com\/openai\/v1\//);
    assert.equal(c.init.headers.get("api-key"), "azure-fixture");
  }
  assert.equal(JSON.parse(calls[0].init.body).model, "image-alias");
  assert.equal(JSON.parse(calls[1].init.body).model, "embedding-alias");
});
test("explicit image selection uses OpenAI without changing text or embedding endpoints", async () => {
  const calls = [];
  const api = loadProvider(
    {
      ...azure,
      KOVA_IMAGE_PROVIDER: "openai",
      AZURE_OPENAI_DEPLOYMENT_IMAGE: "missing-image-alias",
      AZURE_OPENAI_DEPLOYMENT_EMBEDDING: "embedding-alias",
    },
    async (url, init) => {
      calls.push({ url, init });
      return new Response('{"data":[]}');
    },
  );
  await api.imageGenerations({ model: "gpt-image-2.5-flare", prompt: "fixture" });
  await api.embeddings({ model: "text-embedding-3-small", input: "fixture" });
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer openai-fixture");
  assert.equal(calls[0].init.headers.has("api-key"), false);
  assert.equal(JSON.parse(calls[0].init.body).model, "gpt-image-2.5-flare");
  assert.equal(calls[1].url, "https://fixture.openai.azure.com/openai/v1/embeddings");
  assert.equal(JSON.parse(calls[1].init.body).model, "embedding-alias");
  assert.equal(api.getAiProviderConfig().provider, "azure_openai");
  assert.doesNotMatch(JSON.stringify(api.logs), /openai-fixture|azure-fixture/);
});
test("invalid or incomplete image selection cannot make provider calls or fall back", async () => {
  let calls = 0;
  for (const env of [
    {
      AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: "fixture",
      KOVA_IMAGE_PROVIDER: "openai",
    },
    { OPENAI_API_KEY: "fixture", KOVA_IMAGE_PROVIDER: "azure_openai" },
    { ...azure, KOVA_IMAGE_PROVIDER: "invalid" },
  ]) {
    const api = loadProvider(env, async () => {
      calls++;
      return new Response("{}");
    });
    await assert.rejects(api.imageGenerations({ model: "gpt-image-2.5-flare", prompt: "fixture" }));
  }
  assert.equal(calls, 0);
});

test("provider rejection does not trigger fallback or retry", async () => {
  let calls = 0;
  const api = loadProvider({ ...azure, KOVA_TEXT_PROVIDER: "openai" }, async () => {
    calls++;
    return new Response("{}", { status: 429 });
  });
  const response = await api.developerResponses({ model: "gpt-5.6-luna" });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  await response.body.cancel();
});

test("HTTP-200 failed or incomplete Responses cannot become successful tool-hop replies", async () => {
  for (const result of [
    {},
    { output: [{ type: "message", content: [{ text: "partial" }] }] },
    { status: "", output: [] },
    { status: "failed", output: [] },
    { status: "cancelled", output: [] },
    { status: "incomplete", output: [{ type: "message", content: [{ text: "partial" }] }] },
    { error: { message: "private-provider-error" }, output: [] },
    null,
    [],
  ]) {
    const api = loadProvider(
      { KOVA_TEXT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" },
      async () => Response.json(result),
    );
    await assert.rejects(
      api.chatCompletions({
        model: "gpt-5.6-luna",
        stream: false,
        messages: [{ role: "user", content: "fixture" }],
      }),
      (error) => {
        assert.equal(error.code, "provider_bad_response");
        assert.equal(error.status, 502);
        assert.doesNotMatch(error.message, /private-provider-error|partial/u);
        return true;
      },
    );
  }
});

test("completed Responses preserve actual reply and usage without a model retry", async () => {
  let calls = 0;
  const api = loadProvider(
    { KOVA_TEXT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" },
    async () => {
      calls++;
      return Response.json({
        status: "completed",
        model: "gpt-5.6-luna",
        output: [{ type: "message", content: [{ type: "output_text", text: "fixture reply" }] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    },
  );
  const response = await api.chatCompletions({
    model: "gpt-5.6-luna",
    stream: false,
    messages: [{ role: "user", content: "fixture" }],
  });
  const body = await response.json();
  assert.equal(body.choices[0].message.content, "fixture reply");
  assert.equal(body.choices[0].finish_reason, "stop");
  assert.equal(body.usage.total_tokens, 6);
  assert.equal(calls, 1);
});

test("native nonstream Responses metadata is bounded before chat conversion", async () => {
  let cancelled = false;
  const api = loadProvider(
    { KOVA_TEXT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" },
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  await assert.rejects(
    api.chatCompletions({
      model: "gpt-5.6-luna",
      stream: false,
      messages: [{ role: "user", content: "fixture" }],
    }),
    (error) => {
      assert.equal(error.status, 502);
      return true;
    },
  );
  assert.equal(cancelled, true);
});
