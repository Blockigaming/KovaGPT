import * as imageSizes from "../../src/lib/multimodal/image-size-policy.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/endpoint-reliability.mjs";
import * as imagePolicy from "../../src/lib/multimodal/image-request-policy.mjs";

function actualModule(path, bindings, expose, suffix = "") {
  const source = stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "strip" })
    .replace(/^import\b[\s\S]*?;[ \t]*$/gmu, "")
    .replace(/^export\s+(?=(?:async\s+)?function\b|class\b|const\b)/gmu, "");
  const context = vm.createContext({
    URL,
    Headers,
    Request,
    Response,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Blob,
    FormData,
    Uint8Array,
    setTimeout,
    clearTimeout,
    Date,
    Buffer,
    Error,
    console: { info() {}, warn() {}, error() {} },
    ...bindings,
  });
  vm.runInContext(source + "\n" + suffix + "\nglobalThis.actual = { " + expose + " };", context);
  return context.actual;
}

const azure = {
  KOVA_TEXT_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-openai-not-a-key",
  AZURE_OPENAI_ENDPOINT: "https://synthetic-primary.openai.azure.com",
  AZURE_OPENAI_API_KEY: "synthetic-primary-not-a-key",
  AZURE_OPENAI_IMAGE_ENDPOINT: "https://synthetic-image.openai.azure.com",
  AZURE_OPENAI_IMAGE_API_KEY: "synthetic-image-not-a-key",
  AZURE_OPENAI_DEPLOYMENT_IMAGE: "synthetic-image-deployment",
  AZURE_OPENAI_DEPLOYMENT_EMBEDDING: "synthetic-embedding-deployment",
};
function provider(env = azure, generationEnabled = true) {
  const calls = [];
  const api = actualModule(
    "src/lib/ai/provider.server.ts",
    {
      ...transport,
      ...bounded,
      runtimeEnv: (key) => env[key],
      getAiRuntimeConfig: () => ({ generationEnabled }),
      modelForPolicy: (policy) => ({ id: policy === "deep" ? "gpt-5.6-sol" : "gpt-5.6-luna" }),
      maximumServerOutputForModel: () => 4096,
      meterProviderRequest: (input) => input.send(),
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ data: [] });
      },
    },
    "getAiProviderConfig, providerCapabilityConfigured, providerUnavailableEnvelope, providerModelId, imageGenerations, embeddings",
  );
  return { ...api, calls };
}

test("mixed-provider configuration reports the image and embedding targets actually used", () => {
  const api = provider();
  assert.equal(api.getAiProviderConfig().provider, "openai");
  assert.equal(api.getAiProviderConfig("image_generation").provider, "azure_openai");
  assert.equal(
    api.getAiProviderConfig("image_generation").baseUrl,
    "https://synthetic-image.openai.azure.com/openai/v1",
  );
  assert.equal(api.getAiProviderConfig("embeddings").provider, "azure_openai");
  assert.equal(
    api.getAiProviderConfig("embeddings").baseUrl,
    "https://synthetic-primary.openai.azure.com/openai/v1",
  );
  assert.equal(api.calls.length, 0);
});

test("missing OpenAI text credentials do not disable separately configured Azure media", async () => {
  const api = provider({ ...azure, OPENAI_API_KEY: undefined });
  assert.equal(api.providerUnavailableEnvelope("chat").status, 503);
  for (const capability of ["image_generation", "embeddings"]) {
    assert.equal(api.providerCapabilityConfigured(capability), true);
    assert.equal(api.providerUnavailableEnvelope(capability), null);
  }
  await (await api.imageGenerations({ model: "gpt-image-1", prompt: "Synthetic square" })).text();
  await (await api.embeddings({ model: "text-embedding-3-small", input: "Synthetic text" })).text();
  assert.deepEqual(
    api.calls.map((entry) => entry.url),
    [
      "https://synthetic-image.openai.azure.com/openai/v1/images/generations",
      "https://synthetic-primary.openai.azure.com/openai/v1/embeddings",
    ],
  );
  assert.equal(JSON.parse(api.calls[0].init.body).model, "synthetic-image-deployment");
  assert.equal(JSON.parse(api.calls[1].init.body).model, "synthetic-embedding-deployment");
  assert.equal(api.calls[0].init.headers.get("api-key"), azure.AZURE_OPENAI_IMAGE_API_KEY);
  assert.equal(api.calls[1].init.headers.get("api-key"), azure.AZURE_OPENAI_API_KEY);
  assert.equal(
    api.calls.some((entry) => entry.init.headers.has("authorization")),
    false,
  );
});

test("capability-specific credentials never bypass global generation or configured capability gates", async () => {
  for (const [env, enabled] of [
    [azure, false],
    [{ ...azure, KOVA_AI_CAPABILITIES: "chat" }, true],
  ]) {
    const api = provider(env, enabled);
    for (const operation of ["imageGenerations", "embeddings"]) {
      await assert.rejects(api[operation]({ model: "synthetic" }));
    }
    assert.equal(api.calls.length, 0);
  }
});

test("image settings use Azure format policy even when text uses OpenAI", () => {
  const api = provider();
  const image = actualModule(
    "src/lib/multimodal/image-workflows.server.ts",
    {
      ...imagePolicy,
      ...imageSizes,
      getAiProviderConfig: api.getAiProviderConfig,
      imageModel: () => "gpt-image-1",
      runtimeEnv: () => undefined,
    },
    "normalizeImageSettings",
  );
  assert.throws(
    () => image.normalizeImageSettings({ prompt: "Synthetic square", outputFormat: "webp" }),
    /PNG or JPEG/,
  );
  assert.equal(
    image.normalizeImageSettings({ prompt: "Synthetic square", outputFormat: "png" }).outputFormat,
    "png",
  );
});

test("image and embedding model selection does not borrow missing text credentials", () => {
  const api = provider({ ...azure, OPENAI_API_KEY: undefined });
  const registry = actualModule(
    "src/lib/ai/registry.server.ts",
    {
      getAiProviderConfig: api.getAiProviderConfig,
      modelForPolicy: (policy) => ({
        id: policy === "thinking" ? "gpt-5.6-terra" : "gpt-5.6-luna",
      }),
    },
    "selectModelForCapabilities, selectModelForMode",
  );
  assert.equal(registry.selectModelForMode("image").model.modelId, "gpt-image-2.5-flare");
  assert.equal(
    registry.selectModelForCapabilities(undefined, ["embeddings"], "embedding").model.modelId,
    "text-embedding-3-small",
  );
  assert.throws(() => registry.selectModelForMode("instant"), /temporarily unavailable/);
});

function pricingFixture() {
  const api = provider();
  const queries = [],
    quotes = [];
  const contracts = ["chat", "image_generation", "embeddings"].flatMap((capability) =>
    ["openai", "azure_openai"].map((provider) => ({
      capability,
      provider,
      publicModel: "kova-" + capability,
      upstreamModel: "synthetic-" + capability,
    })),
  );
  const version = {
    id: "synthetic-version",
    currency: "USD",
    public_price_configuration: { contracts },
  };
  const db = {
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      const result = () => ({
        error: null,
        data:
          table === "developer_credit_accounts"
            ? { currency: "USD" }
            : table === "api_pricing_versions"
              ? version
              : [],
      });
      const q = {
        maybeSingle: async () => result(),
        then: (resolve) => Promise.resolve(result()).then(resolve),
      };
      for (const name of ["select", "is", "lte", "gt", "order", "limit", "in"]) q[name] = () => q;
      q.eq = (key, value) => {
        query.filters.push([key, value]);
        return q;
      };
      return q;
    },
  };
  const identity = {
    id: "synthetic-key",
    account_id: "synthetic-account",
    capabilities: ["chat", "image_generation", "embeddings"],
    db,
  };
  const platform = actualModule(
    "src/lib/pricing/developer-platform.server.ts",
    {
      createHash,
      ...api,
      __identity: identity,
      developerFileReferences: (_kind, body) => ({ body: { ...body }, ids: [] }),
      parseDeveloperInput: (kind, body) => ({
        capability:
          kind === "images" ? "image_generation" : kind === "embeddings" ? "embeddings" : "chat",
        publicModel:
          "kova-" +
          (kind === "images" ? "image_generation" : kind === "embeddings" ? "embeddings" : "chat"),
        body,
      }),
      loadDeveloperFileContent: async (_identity, body) => ({
        body,
        bindings: [],
        expiresAt: null,
      }),
      fundingAdjustedVersion: (value) => value,
      pricingRegistryIds: () => [],
      prepareDeveloperQuote: (_pricing, request) => {
        quotes.push(request);
        return { quote: { maximumReservedCharge: 1 } };
      },
    },
    "preparePublicRequest, handleDeveloperApi",
    "authenticateDeveloper = async () => __identity;",
  );
  return { platform, identity, queries, quotes, contracts };
}

for (const kind of ["images", "embeddings"]) {
  test(
    "developer " + kind + " quotes and registry lookups bind the actual Azure capability",
    async () => {
      const f = pricingFixture();
      const value = await f.platform.preparePublicRequest(f.identity, kind, { input: "Synthetic" });
      assert.equal(f.quotes.length, 1);
      assert.equal(f.quotes[0].provider, "azure_openai");
      assert.equal(f.quotes[0].capability, kind === "images" ? "image_generation" : "embeddings");
      assert.equal(
        value.body.model,
        kind === "images" ? "synthetic-image-deployment" : "synthetic-embedding-deployment",
      );
      const registry = f.queries.find((query) => query.table === "upstream_price_registry");
      assert.ok(
        registry.filters.some(([key, value]) => key === "provider" && value === "azure_openai"),
      );
    },
  );
}

test("developer model listing uses each contract's capability instead of the text provider", async () => {
  const f = pricingFixture();
  for (const entry of f.contracts) entry.publicModel += "-" + entry.provider;
  const response = await f.platform.handleDeveloperApi(
    new Request("https://synthetic.example/api/v1/models"),
    "models",
  );
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.data.length, 3);
  assert.deepEqual(
    value.data.map((model) => model.capability),
    ["chat", "image_generation", "embeddings"],
  );
  assert.deepEqual(
    value.data.map((model) => model.id),
    ["kova-chat-openai", "kova-image_generation-azure_openai", "kova-embeddings-azure_openai"],
  );
});
