import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/endpoint-reliability.mjs";

function loadModule(path, modules, env) {
  const output = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const denyNetwork = () => assert.fail("Diagnostics must not make a network request");
  new Function("exports", "require", "process", "fetch", output)(
    exports,
    (key) => {
      assert.ok(Object.hasOwn(modules, key), `Unstubbed dependency: ${key}`);
      return modules[key];
    },
    { env },
    denyNetwork,
  );
  return exports;
}

function subject(env = {}) {
  const provider = loadModule(
    "src/lib/ai/provider.server.ts",
    {
      "@/lib/endpoint-reliability.mjs": bounded,
      "@/lib/runtime-env.server": { runtimeEnv: (key) => env[key]?.trim() || undefined },
      "@/lib/pricing/developer-billing.server": {},
      "@/lib/ai/responses-compat.server.mjs": {},
      "@/lib/ai/config.server": {},
      "@/lib/ai/model-catalog.server": {
        modelForPolicy: () => ({ id: "fixture-model" }),
      },
      "@/lib/ai/provider-transport.server.mjs": transport,
    },
    env,
  );
  const diagnostics = loadModule(
    "src/lib/config/diagnostics.server.ts",
    { "@/lib/ai/provider.server": provider },
    env,
  );
  return { provider, report: diagnostics.safeDiagnostics() };
}

const azure = {
  AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
  AZURE_OPENAI_API_KEY: "fixture-azure-key",
  AZURE_OPENAI_DEPLOYMENT_CHAT: "fixture-chat",
  AZURE_OPENAI_DEPLOYMENT_THINKING: "fixture-thinking",
  AZURE_OPENAI_DEPLOYMENT_DEEP: "fixture-deep",
};

test("diagnostics follows explicit OpenAI while retaining Azure image/embedding settings", () => {
  const env = {
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-openai-key",
    AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_DEPLOYMENT_IMAGE: "fixture-image",
    AZURE_OPENAI_DEPLOYMENT_EMBEDDING: "fixture-embedding",
  };
  const before = structuredClone(env);
  const result = subject(env);
  assert.equal(result.provider.getAiProviderConfig().provider, "openai");
  assert.deepEqual(result.report.features.aiProvider, { configured: true, missing: [] });
  assert.deepEqual(env, before);
  assert.doesNotMatch(JSON.stringify(result.report), /fixture-(?:openai-key|image|embedding)/u);
});

test("explicit OpenAI diagnostics cannot borrow Azure credentials", () => {
  const result = subject({ ...azure, KOVA_TEXT_PROVIDER: "openai" });
  assert.deepEqual(result.report.features.aiProvider, {
    configured: false,
    missing: ["OPENAI_API_KEY"],
  });
});

test("explicit Azure diagnostics cannot borrow an OpenAI key", () => {
  for (const endpoint of [undefined, azure.AZURE_OPENAI_ENDPOINT]) {
    const result = subject({
      KOVA_TEXT_PROVIDER: "azure_openai",
      AZURE_OPENAI_ENDPOINT: endpoint,
      OPENAI_API_KEY: "fixture-openai-key",
    });
    assert.equal(result.report.features.aiProvider.configured, false);
    assert.doesNotMatch(JSON.stringify(result.report), /fixture-openai-key/u);
  }
});

test("legacy auto diagnostics retains Azure priority and direct OpenAI fallback", () => {
  for (const selection of [undefined, "auto"]) {
    const preferred = subject({
      ...azure,
      KOVA_TEXT_PROVIDER: selection,
      OPENAI_API_KEY: "fixture",
    });
    assert.equal(preferred.provider.getAiProviderConfig().provider, "azure_openai");
    assert.deepEqual(preferred.report.features.aiProvider, { configured: true, missing: [] });
    const fallback = subject({ KOVA_TEXT_PROVIDER: selection, OPENAI_API_KEY: "fixture" });
    assert.equal(fallback.provider.getAiProviderConfig().provider, "openai");
    assert.deepEqual(fallback.report.features.aiProvider, { configured: true, missing: [] });
  }
});

test("Azure diagnostics preserves required text aliases and managed-identity checks", () => {
  const env = {
    ...azure,
    KOVA_TEXT_PROVIDER: "azure_openai",
    AZURE_OPENAI_API_KEY: "",
    IDENTITY_ENDPOINT: "http://fixture-identity.test",
    IDENTITY_HEADER: "fixture-identity",
  };
  assert.deepEqual(subject(env).report.features.aiProvider, { configured: true, missing: [] });
  assert.deepEqual(
    subject({ ...env, AZURE_OPENAI_DEPLOYMENT_DEEP: "" }).report.features.aiProvider,
    {
      configured: false,
      missing: ["AZURE_OPENAI_DEPLOYMENT_DEEP"],
    },
  );
  assert.equal(
    subject({ ...env, IDENTITY_HEADER: "" }).report.features.aiProvider.configured,
    false,
  );
});

test("invalid selections and endpoint errors fail closed without exposing rejected input", () => {
  for (const changed of [
    { KOVA_TEXT_PROVIDER: "fixture-private-invalid-selection" },
    { KOVA_TEXT_PROVIDER: "azure_openai", AZURE_OPENAI_ENDPOINT: "https://fixture-private.test" },
  ]) {
    const result = subject({ ...azure, ...changed });
    assert.deepEqual(result.report.features.aiProvider, {
      configured: false,
      missing: ["KOVA_TEXT_PROVIDER or AZURE_OPENAI_ENDPOINT"],
    });
    assert.doesNotMatch(JSON.stringify(result.report), /fixture-private|fixture-azure-key/u);
  }
});
