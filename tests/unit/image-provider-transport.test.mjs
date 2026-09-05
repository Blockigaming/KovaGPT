import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/endpoint-reliability.mjs";
function loadProvider(env, fetcher) {
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
    "@/lib/ai/config.server": { getAiRuntimeConfig: () => ({ generationEnabled: true }) },
    "@/lib/ai/model-catalog.server": {
      modelForPolicy: () => ({ id: "gpt-5.6-luna" }),
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
const image = { bytes: new Uint8Array(16).fill(44), contentType: "image/png" };
test("image edits send actual multipart bytes on the edit endpoint through existing authentication and accounting", async () => {
  let call;
  const api = loadProvider(
    { OPENAI_API_KEY: "private-fixture-key", KOVA_IMAGE_EDITS_ENABLED: "true" },
    async (url, init) => {
      call = { url, init };
      return new Response('{"data":[]}');
    },
  );
  await api.imageEdits(
    {
      model: "gpt-image-1",
      prompt: "private prompt",
      size: "1024x1024",
      output_format: "png",
      n: 1,
    },
    { image, mask: image },
  );
  assert.equal(call.url, "https://api.openai.com/v1/images/edits");
  assert.equal(call.init.headers.get("authorization"), "Bearer private-fixture-key");
  assert.equal(call.init.headers.has("content-type"), false);
  assert.ok(call.init.body instanceof FormData);
  assert.deepEqual(new Uint8Array(await call.init.body.get("image").arrayBuffer()), image.bytes);
  assert.deepEqual(new Uint8Array(await call.init.body.get("mask").arrayBuffer()), image.bytes);
  assert.equal(call.init.body.get("prompt"), "private prompt");
  assert.equal(api.meters.length, 1);
  assert.equal(api.meters[0].capability, "image_generation");
  assert.doesNotMatch(JSON.stringify(api.logs), /private prompt|private-fixture-key/);
});
test("Azure image edits keep configured deployment mapping and server API-key authentication", async () => {
  let call;
  const api = loadProvider(
    {
      AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
      AZURE_OPENAI_API_KEY: "azure-secret",
      AZURE_OPENAI_DEPLOYMENT_IMAGE: "custom-image-deployment",
      KOVA_IMAGE_EDITS_ENABLED: "true",
    },
    async (url, init) => {
      call = { url, init };
      return new Response("{}");
    },
  );
  await api.imageEdits({ model: "gpt-image-1", prompt: "private", n: 1 }, { image });
  assert.equal(call.url, "https://fixture.openai.azure.com/openai/v1/images/edits");
  assert.equal(call.init.headers.get("api-key"), "azure-secret");
  assert.equal(call.init.body.get("model"), "custom-image-deployment");
});
test("disabled editing and oversized source bytes never call the provider", async () => {
  let calls = 0;
  for (const enabled of [false, true]) {
    const api = loadProvider(
      { OPENAI_API_KEY: "secret", KOVA_IMAGE_EDITS_ENABLED: String(enabled) },
      async () => {
        calls++;
        return new Response("{}");
      },
    );
    await assert.rejects(
      api.imageEdits(
        { model: "gpt-image-1" },
        { image: enabled ? { ...image, bytes: new Uint8Array(8 * 1024 * 1024 + 1) } : image },
      ),
    );
  }
  assert.equal(calls, 0);
});
test("image generation and edit results cannot overflow or remain pending after caller abort", async () => {
  let cancelled = false;
  const api = loadProvider(
    { OPENAI_API_KEY: "secret", KOVA_IMAGE_EDITS_ENABLED: "true" },
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(12 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(api.imageGenerations({ model: "gpt-image-1" }));
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const stalled = loadProvider(
    { OPENAI_API_KEY: "secret", KOVA_IMAGE_EDITS_ENABLED: "true" },
    async () =>
      new Response(
        new ReadableStream({
          pull() {},
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const pending = stalled.imageEdits(
    { model: "gpt-image-1" },
    { image },
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending);
});
