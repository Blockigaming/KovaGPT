import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
const output = ts.transpileModule(fs.readFileSync("src/lib/azure-runtime-env.server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", output)(exports, () => ({
  parseTrustedProxyCertificateFingerprints: () => true,
}));
const validate = exports.validateAzureRuntimeEnv;
const azure = {
  AZURE_OPENAI_ENDPOINT: "https://fixture.openai.azure.com",
  AZURE_OPENAI_API_KEY: "fixture-azure",
  AZURE_OPENAI_DEPLOYMENT_CHAT: "chat",
  AZURE_OPENAI_DEPLOYMENT_THINKING: "think",
  AZURE_OPENAI_DEPLOYMENT_DEEP: "deep",
};
test("OpenAI selection boots without unused Azure text aliases while keeping its valid endpoint", () => {
  assert.doesNotThrow(() =>
    validate({
      AI_GENERATION_ENABLED: "true",
      KOVA_TEXT_PROVIDER: "openai",
      OPENAI_API_KEY: "fixture-openai",
      AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT,
    }),
  );
});
test("selected OpenAI cannot borrow Azure credentials", () => {
  assert.throws(
    () => validate({ ...azure, AI_GENERATION_ENABLED: "true", KOVA_TEXT_PROVIDER: "openai" }),
    /selected OpenAI/,
  );
});
test("selected Azure cannot borrow OpenAI credentials or a missing endpoint", () => {
  for (const partial of [{}, { AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT }]) {
    assert.throws(
      () =>
        validate({
          ...partial,
          AI_GENERATION_ENABLED: "true",
          KOVA_TEXT_PROVIDER: "azure_openai",
          OPENAI_API_KEY: "fixture-openai",
        }),
      /selected Azure/,
    );
  }
});
test("explicit Azure and legacy auto preserve existing startup behavior", () => {
  assert.doesNotThrow(() =>
    validate({ ...azure, AI_GENERATION_ENABLED: "true", KOVA_TEXT_PROVIDER: "azure_openai" }),
  );
  assert.doesNotThrow(() => validate({ ...azure, AI_GENERATION_ENABLED: "true" }));
  assert.throws(() => validate({ AZURE_OPENAI_ENDPOINT: azure.AZURE_OPENAI_ENDPOINT }), /missing/);
});
test("invalid selection is rejected without echoing its value", () => {
  assert.throws(
    () => validate({ KOVA_TEXT_PROVIDER: "private-invalid-value" }),
    (error) =>
      /KOVA_TEXT_PROVIDER/.test(error.message) && !error.message.includes("private-invalid-value"),
  );
});
test("retained Azure endpoint remains validated for nontext capabilities", () => {
  assert.throws(
    () =>
      validate({
        AI_GENERATION_ENABLED: "true",
        KOVA_TEXT_PROVIDER: "openai",
        OPENAI_API_KEY: "fixture-openai",
        AZURE_OPENAI_ENDPOINT: "https://untrusted.example",
      }),
    /approved Azure/,
  );
});
test("disabled preparation does not require secrets; public secrets are still rejected", () => {
  assert.doesNotThrow(() =>
    validate({ AI_GENERATION_ENABLED: "false", KOVA_TEXT_PROVIDER: "openai" }),
  );
  assert.throws(() => validate({ VITE_OPENAI_API_KEY: "fixture" }), /public VITE_/);
});
