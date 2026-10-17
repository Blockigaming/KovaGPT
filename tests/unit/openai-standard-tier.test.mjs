// Source baseline: 24e6e3b9fbf43e2d81ac1406764b5987b7d8bb23.
// Provider baseline Git blob: 79b6e4a48ed247934243fb47f8678d6d1280ab1d.
// Node 24 preparation harness; actual provider functions, no app bootstrap or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/lib/ai/provider.server.ts", import.meta.url),
  "utf8",
);
// Remove only static import declarations and export modifiers after Node strips
// types. Runtime dependencies are explicit fake seams; policy functions remain
// the actual source. No implementation of the tier policy is copied here.
const executable = stripTypeScriptTypes(source, { mode: "strip" })
  .replace(/^import\b[\s\S]*?;[ \t]*$/gmu, "")
  .replace(/^export\s+(?=(?:async\s+)?function\b|class\b|const\b)/gmu, "");
assert.doesNotMatch(executable, /^import\b/mu);

function harness(extra = {}) {
  const environment = {
    OPENAI_API_KEY: "offline-nonsecret-value",
    KOVA_TEXT_PROVIDER: "openai",
    ...extra,
  };
  const calls = [];
  const context = vm.createContext({
    URL,
    Headers,
    Response,
    AbortController,
    console: { info() {}, warn() {}, error() {} },
    runtimeEnv: (name) => environment[name],
    maximumServerOutputForModel: () => 700,
    modelForPolicy: (policy) => ({ id: policy === "instant" ? "gpt-5.6-luna" : "gpt-5.6-sol" }),
    AZURE_COGNITIVE_SERVICES_MANAGED_IDENTITY_RESOURCE: "https://cognitiveservices.azure.com",
    AZURE_FOUNDRY_MANAGED_IDENTITY_RESOURCE: "https://ai.azure.com",
    createManagedIdentityTokenFetcher: () => () => {
      throw new Error("NETWORK_FORBIDDEN");
    },
    fetch: () => {
      throw new Error("NETWORK_FORBIDDEN");
    },
    __captureFetch: async (path, capability, body, init, sourceBody) => {
      calls.push({ path, capability, body, init, sourceBody });
      // Non-success avoids invoking response adapters. This tests the actual
      // canonical request conversion and the native forwarding contract only.
      return new Response("", { status: 503 });
    },
  });
  vm.runInContext(
    `${executable}\nproviderFetch = (path, capability, body, init) => __captureFetch(path, capability, withProviderModel(body, capability), init, body);\n` +
      `globalThis.actual = { chatCompletions, developerResponses, providerTarget };`,
    context,
    { timeout: 1000 },
  );
  return { actual: context.actual, calls };
}

for (const stream of [false, true]) {
  test(`canonical direct OpenAI ${stream ? "streaming" : "nonstreaming"} explicitly requests Standard`, async () => {
    for (const tier of [undefined, "priority", "flex", "auto"]) {
      const { actual, calls } = harness();
      const body = {
        model: "gpt-5.6-luna",
        messages: [{ role: "user", content: "A blue bicycle." }],
        stream,
        max_completion_tokens: 1000,
        reasoning: { effort: "low", summary: "auto" },
        ...(tier === undefined ? {} : { service_tier: tier }),
      };
      const before = JSON.stringify(body);
      const response = await actual.chatCompletions(body);
      assert.equal(response.status, 503); // Synthetic boundary, not live acceptance.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, "/responses");
      assert.equal(calls[0].capability, stream ? "streaming" : "chat");
      assert.equal(calls[0].body.service_tier, "default");
      assert.equal(calls[0].body.stream, stream);
      assert.equal(calls[0].body.model, body.model);
      assert.equal(calls[0].body.max_output_tokens, 700);
      assert.equal(calls[0].body.store, false);
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.reasoning)), body.reasoning);
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.input)), body.messages);
      assert.equal(JSON.stringify(body), before);
    }
  });
}

test("canonical conversion preserves a lower token cap, instructions and tool settings", async () => {
  const { actual, calls } = harness();
  await actual.chatCompletions({
    model: "gpt-5.6-luna",
    stream: true,
    max_tokens: 120,
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "A bicycle." },
    ],
    tools: [],
    tool_choice: "none",
  });
  assert.equal(calls[0].body.max_output_tokens, 120);
  assert.equal(calls[0].body.instructions, "Be brief.");
  assert.equal(calls[0].body.tool_choice, "none");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.tools)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.reasoning)), {
    effort: "low",
    summary: "auto",
  });
  assert.equal(calls[0].body.store, false);
});

test("Azure canonical text selects Azure and receives no OpenAI service-tier field", async () => {
  for (const stream of [false, true]) {
    const { actual, calls } = harness({
      KOVA_TEXT_PROVIDER: "azure_openai",
      AZURE_OPENAI_ENDPOINT: "https://offline-primary.openai.azure.com",
      AZURE_OPENAI_API_KEY: "offline-nonsecret-value",
      AZURE_OPENAI_DEPLOYMENT_CHAT: "offline-chat-deployment",
    });
    assert.equal(actual.providerTarget("chat").provider, "azure_openai");
    assert.equal(actual.providerTarget("streaming").provider, "azure_openai");
    await actual.chatCompletions({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "A bicycle." }],
      stream,
      service_tier: "priority",
      max_completion_tokens: 700,
    });
    assert.equal(Object.hasOwn(calls[0].body, "service_tier"), false);
    assert.equal(calls[0].body.model, "offline-chat-deployment");
    assert.equal(calls[0].body.max_output_tokens, 700);
    assert.equal(calls[0].body.store, false);
  }
});

test("explicit OpenAI text selection preserves dedicated Azure image and primary embedding selection", () => {
  const { actual } = harness({
    AZURE_OPENAI_ENDPOINT: "https://offline-primary.openai.azure.com",
    AZURE_OPENAI_API_KEY: "offline-primary-nonsecret",
    AZURE_OPENAI_IMAGE_ENDPOINT: "https://offline-images.openai.azure.com",
    AZURE_OPENAI_IMAGE_API_KEY: "offline-image-nonsecret",
  });
  assert.equal(actual.providerTarget("chat").provider, "openai");
  assert.equal(actual.providerTarget("streaming").provider, "openai");
  assert.equal(actual.providerTarget("image_generation").provider, "azure_openai");
  assert.equal(
    actual.providerTarget("image_generation").baseUrl,
    "https://offline-images.openai.azure.com/openai/v1",
  );
  assert.equal(actual.providerTarget("embeddings").provider, "azure_openai");
  assert.equal(
    actual.providerTarget("embeddings").baseUrl,
    "https://offline-primary.openai.azure.com/openai/v1",
  );
});

test("native developer Responses preserves explicit tiers and omission without canonical conversion", async () => {
  for (const stream of [false, true]) {
    for (const tier of [undefined, "priority", "flex", "auto", "default"]) {
      const { actual, calls } = harness();
      const body = {
        model: "gpt-5.6-luna",
        input: "A bicycle.",
        stream,
        ...(tier === undefined ? {} : { service_tier: tier }),
      };
      const before = JSON.stringify(body);
      await actual.developerResponses(body);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, "/responses");
      assert.equal(calls[0].sourceBody, body);
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), body);
      assert.equal(calls[0].body.service_tier, tier);
      assert.equal(Object.hasOwn(calls[0].body, "service_tier"), tier !== undefined);
      assert.equal(JSON.stringify(body), before);
    }
  }
});
