import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/endpoint-reliability.mjs";

// Execute the actual startup, readiness, runtime configuration and provider
// modules with nonsecret inputs. Every HTTP boundary is a local fixture.
function loadModule(path, modules, fetcher, logs) {
  const output = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", "fetch", "console", output)(
    exports,
    (key) => {
      assert.ok(Object.hasOwn(modules, key), `Unstubbed dependency: ${key}`);
      return modules[key];
    },
    fetcher,
    {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  );
  return exports;
}

function pipeline(overrides = {}) {
  const env = {
    KOVA_PUBLIC_URL: "https://preview.example.test",
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    KOVA_IP_HASH_SECRET: "fixture-only-ip-hash-secret-32-characters",
    ...overrides,
  };
  const calls = [];
  const logs = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://fixture.supabase.co/rest/v1/rpc/kovagpt_schema_health") {
      return Response.json({ ready: true, version: "20260803120000-v1" });
    }
    assert.ok(
      [
        "https://api.openai.com/v1/responses",
        "https://fixture.openai.azure.com/openai/v1/responses",
      ].includes(url),
      "Unexpected fixture request",
    );
    return Response.json({ id: "fixture-response", output: [] });
  };
  const runtime = { runtimeEnv: (key) => env[key]?.trim() || undefined };
  const config = loadModule(
    "src/lib/ai/config.server.ts",
    {
      zod: { z },
      "@/lib/runtime-env.server": runtime,
    },
    fetcher,
    logs,
  );
  const provider = loadModule(
    "src/lib/ai/provider.server.ts",
    {
      "@/lib/endpoint-reliability.mjs": bounded,
      "@/lib/runtime-env.server": runtime,
      "@/lib/pricing/developer-billing.server": {
        meterProviderRequest: async (input) => input.send(),
      },
      "@/lib/ai/responses-compat.server.mjs": {},
      "@/lib/ai/config.server": config,
      "@/lib/ai/model-catalog.server": {
        modelForPolicy: () => ({ id: "gpt-5.6-luna" }),
        maximumServerOutputForModel: () => 4096,
      },
      "@/lib/ai/provider-transport.server.mjs": transport,
    },
    fetcher,
    logs,
  );
  const readiness = loadModule(
    "src/lib/readiness.server.ts",
    {
      "@/lib/runtime-env.server": runtime,
      "@/config/public-config": { PUBLIC_STRIPE_ACCOUNT_ID: "fixture-account" },
      "@/lib/stripe-browser-config": { COMPILED_PAYMENTS_CLIENT_TOKEN: "" },
      "@/lib/ai/provider.server": provider,
    },
    fetcher,
    logs,
  );
  const startup = loadModule(
    "src/lib/azure-runtime-env.server.ts",
    {
      "./origin-boundary.server": { parseTrustedProxyCertificateFingerprints: () => true },
    },
    fetcher,
    logs,
  );
  return { env, calls, logs, provider, readiness, startup };
}

const azure = {
  AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
  AZURE_OPENAI_API_KEY: "fixture-azure-key",
  AZURE_OPENAI_DEPLOYMENT_CHAT: "fixture-chat",
  AZURE_OPENAI_DEPLOYMENT_THINKING: "fixture-thinking",
  AZURE_OPENAI_DEPLOYMENT_DEEP: "fixture-deep",
};

test("startup, readiness and text transport agree on OpenAI with a retained Azure endpoint", async () => {
  const subject = pipeline({
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-openai-key",
    AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
    AI_GENERATION_ENABLED: "true",
    KOVA_GENERATION_DISABLED: "false",
  });
  assert.doesNotThrow(() => subject.startup.validateAzureRuntimeEnv(subject.env));
  assert.equal(subject.readiness.structuralReadiness().capabilities.aiProvider.state, "ready");
  assert.equal(subject.calls.length, 0);
  const report = await subject.readiness.runtimeReadiness();
  assert.equal(report.status, "ready");
  assert.equal(report.capabilities.aiProvider.state, "ready");
  const response = await subject.provider.developerResponses({
    model: "gpt-5.6-luna",
    input: "fixture",
  });
  await response.text();
  assert.deepEqual(
    subject.calls.map((call) => call.url),
    [
      "https://fixture.supabase.co/rest/v1/rpc/kovagpt_schema_health",
      "https://api.openai.com/v1/responses",
    ],
  );
  const request = subject.calls[1].init;
  assert.equal(request.headers.get("authorization"), "Bearer fixture-openai-key");
  assert.equal(request.headers.has("api-key"), false);
  assert.equal(JSON.parse(request.body).model, "gpt-5.6-luna");
  assert.doesNotMatch(
    JSON.stringify({ report, logs: subject.logs }),
    /fixture-(?:openai-key|service)/u,
  );
});

test("explicit OpenAI readiness cannot borrow Azure credentials", () => {
  const subject = pipeline({ ...azure, KOVA_TEXT_PROVIDER: "openai" });
  assert.equal(
    subject.readiness.structuralReadiness().capabilities.aiProvider.state,
    "unavailable",
  );
  assert.equal(subject.provider.getAiProviderConfig().configured, false);
  assert.equal(subject.calls.length, 0);
});

test("explicit Azure readiness cannot borrow a direct OpenAI key", () => {
  for (const partial of [{}, { AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT }]) {
    const subject = pipeline({
      ...partial,
      KOVA_TEXT_PROVIDER: "azure_openai",
      OPENAI_API_KEY: "fixture-openai-key",
    });
    assert.equal(
      subject.readiness.structuralReadiness().capabilities.aiProvider.state,
      "unavailable",
    );
    assert.equal(subject.calls.length, 0);
  }
});

test("legacy auto preserves Azure priority, required aliases and direct OpenAI fallback", () => {
  for (const selection of [undefined, "auto"]) {
    const subject = pipeline({
      ...azure,
      KOVA_TEXT_PROVIDER: selection,
      OPENAI_API_KEY: "fixture-openai-key",
    });
    assert.equal(subject.readiness.structuralReadiness().capabilities.aiProvider.state, "ready");
    assert.equal(subject.provider.getAiProviderConfig().provider, "azure_openai");
    const missingAlias = pipeline({
      ...azure,
      KOVA_TEXT_PROVIDER: selection,
      AZURE_OPENAI_DEPLOYMENT_CHAT: "",
    });
    assert.equal(
      missingAlias.readiness.structuralReadiness().capabilities.aiProvider.state,
      "unavailable",
    );
    const direct = pipeline({
      KOVA_TEXT_PROVIDER: selection,
      OPENAI_API_KEY: "fixture-openai-key",
    });
    assert.equal(direct.readiness.structuralReadiness().capabilities.aiProvider.state, "ready");
    assert.equal(subject.calls.length + missingAlias.calls.length + direct.calls.length, 0);
  }
});

test("Azure managed identity remains structural-only and requires all text aliases", () => {
  const subject = pipeline({
    ...azure,
    KOVA_TEXT_PROVIDER: "azure_openai",
    AZURE_OPENAI_API_KEY: "",
    IDENTITY_ENDPOINT: "http://fixture-identity.test",
    IDENTITY_HEADER: "fixture-identity",
  });
  assert.equal(subject.readiness.structuralReadiness().capabilities.aiProvider.state, "ready");
  assert.equal(subject.calls.length, 0);
});

test("invalid selection and malformed Azure endpoint fail readiness without disclosing input", () => {
  for (const changed of [
    { KOVA_TEXT_PROVIDER: "private-invalid-selection" },
    {
      KOVA_TEXT_PROVIDER: "azure_openai",
      AZURE_OPENAI_ENDPOINT: "https://private-invalid-endpoint.test",
    },
  ]) {
    const subject = pipeline({ ...azure, ...changed, OPENAI_API_KEY: "fixture-openai-key" });
    const report = subject.readiness.structuralReadiness();
    assert.equal(report.capabilities.aiProvider.state, "unavailable");
    assert.doesNotMatch(
      JSON.stringify({ report, logs: subject.logs }),
      /private-invalid|fixture-openai-key/u,
    );
    assert.equal(subject.calls.length, 0);
  }
});

test("structural readiness does not override the generation kill switch", async () => {
  const subject = pipeline({
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-openai-key",
    KOVA_GENERATION_DISABLED: "true",
  });
  assert.equal(subject.readiness.structuralReadiness().capabilities.aiProvider.state, "ready");
  await assert.rejects(
    subject.provider.developerResponses({ model: "gpt-5.6-luna", input: "fixture" }),
  );
  assert.equal(subject.calls.length, 0);
});
