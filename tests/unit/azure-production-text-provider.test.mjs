import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProductionTextProviderParameters } from "../../scripts/azure/production-text-provider-parameters.mjs";

const secretUri = `https://production-vault.vault.azure.net/secrets/existing-openai-key/${"a".repeat(32)}`;
const configured = () => ({
  parameters: {
    keyVaultName: { value: "production-vault" },
    textProvider: { value: "openai" },
    openAiApiKeySecretUri: { value: secretUri },
    generationEnabled: { value: false },
  },
});

test("existing Azure parameters retain routing and do not inject a new credential", () => {
  const parameters = {};
  assert.deepEqual(validateProductionTextProviderParameters({ parameters }), {
    textProvider: { value: "auto" },
    openAiApiKeySecretUri: { value: "" },
  });
  assert.deepEqual(parameters, {});
});

test("direct OpenAI requires an existing pinned key reference without enabling generation", () => {
  const input = configured();
  const before = structuredClone(input);
  assert.deepEqual(validateProductionTextProviderParameters(input), {
    textProvider: { value: "openai" },
    openAiApiKeySecretUri: { value: secretUri },
  });
  assert.deepEqual(input, before);
  for (const entry of [undefined, { value: "" }]) {
    const missing = configured();
    if (entry) missing.parameters.openAiApiKeySecretUri = entry;
    else delete missing.parameters.openAiApiKeySecretUri;
    assert.throws(
      () => validateProductionTextProviderParameters(missing),
      /requires the existing OpenAI API key secret reference/u,
    );
  }
});

test("raw keys and unpinned or foreign-vault references fail without disclosing input", () => {
  for (const value of [
    `sk-proj-${"synthetic-only".repeat(4)}`,
    secretUri.replace("production-vault", "another-vault"),
    secretUri.slice(0, secretUri.lastIndexOf("/")),
    `${secretUri}?extra=value`,
    `${secretUri}#fragment`,
    secretUri.replace("https:", "http:"),
    secretUri.replace("https://", "https://username@"),
    `${secretUri}/`,
  ]) {
    const input = configured();
    input.parameters.openAiApiKeySecretUri = { value };
    assert.throws(
      () => validateProductionTextProviderParameters(input),
      (error) => {
        assert.match(error.message, /versioned secret URI/u);
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
});

test("unknown selections and unresolved parameter objects cannot silently fall back", () => {
  for (const value of ["", "OpenAI", "other", "openai "]) {
    const input = configured();
    input.parameters.textProvider = { value };
    assert.throws(() => validateProductionTextProviderParameters(input), /text provider/u);
  }
  for (const name of ["textProvider", "openAiApiKeySecretUri", "keyVaultName"]) {
    const input = configured();
    input.parameters[name] = { reference: { secretName: "unresolved" } };
    assert.throws(() => validateProductionTextProviderParameters(input), /string value/u);
  }
});

test("rollback may retain the OpenAI reference without changing Azure selection", () => {
  const input = configured();
  input.parameters.textProvider.value = "azure_openai";
  const result = validateProductionTextProviderParameters(input);
  assert.equal(result.textProvider.value, "azure_openai");
  assert.equal(result.openAiApiKeySecretUri.value, secretUri);
});

test("production passes the key by secret reference and keeps the plan non-deploying", () => {
  const bicep = readFileSync("infra/azure/production/main.bicep", "utf8");
  const workflow = readFileSync(".github/workflows/validate-azure-production.yml", "utf8");
  const parameters = JSON.parse(
    readFileSync("infra/azure/production/main.parameters.example.json", "utf8"),
  ).parameters;
  assert.equal(parameters.textProvider.value, "auto");
  assert.equal(parameters.openAiApiKeySecretUri.value, "");
  assert.equal(parameters.generationEnabled.value, false);
  assert.match(bicep, /@secure\(\)\s+param openAiApiKeySecretUri string = ''/u);
  assert.match(bicep, /name: 'KOVA_TEXT_PROVIDER'\s+value: textProvider/u);
  assert.match(bicep, /keyVaultUrl: openAiApiKeySecretUri\s+identity: identity\.id/u);
  assert.match(bicep, /name: 'OPENAI_API_KEY'\s+secretRef: 'openai-api-key'/u);
  assert.doesNotMatch(bicep, /name: 'OPENAI_API_KEY'\s+value:/u);
  assert.doesNotMatch(bicep, /Microsoft\.KeyVault\/vaults\/secrets@/u);
  assert.match(workflow, /validateProductionTextProviderParameters\(\{/u);
  assert.doesNotMatch(
    workflow,
    /az deployment group create|az containerapp update|az keyvault secret set/u,
  );
});
