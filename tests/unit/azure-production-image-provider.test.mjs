import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProductionImageProviderParameters } from "../../scripts/azure/production-image-provider-parameters.mjs";

const secretUri = `https://image-vault.vault.azure.net/secrets/image-key/${"b".repeat(32)}`;
const configured = () => ({
  parameters: {
    azureOpenAiImageAccountName: { value: "fixture-images" },
    azureOpenAiImageApiKeySecretUri: { value: secretUri },
    keyVaultName: { value: "different-vault" },
    generationEnabled: { value: false },
  },
});

test("primary and dedicated managed-identity image paths remain valid without a key", () => {
  for (const parameters of [
    {},
    { azureOpenAiImageAccountName: { value: "" } },
    { azureOpenAiImageAccountName: { value: "fixture-images" } },
    {
      azureOpenAiImageAccountName: { value: "fixture-images" },
      azureOpenAiImageApiKeySecretUri: { value: "" },
    },
  ]) {
    const before = structuredClone(parameters);
    assert.deepEqual(validateProductionImageProviderParameters({ parameters }), {
      azureOpenAiImageAccountName: { value: parameters.azureOpenAiImageAccountName?.value ?? "" },
      azureOpenAiImageApiKeySecretUri: { value: "" },
    });
    assert.deepEqual(parameters, before);
  }
});

test("a pinned image key is preserved for its dedicated account without enabling generation", () => {
  const input = configured();
  const before = structuredClone(input);
  assert.deepEqual(validateProductionImageProviderParameters(input), {
    azureOpenAiImageAccountName: { value: "fixture-images" },
    azureOpenAiImageApiKeySecretUri: { value: secretUri },
  });
  // The existing template does not constrain image references to keyVaultName.
  // Vault authorization must still be proven separately, not inferred here.
  assert.deepEqual(input, before);
});

test("a key cannot be silently ignored by the primary-account template branch", () => {
  for (const entry of [undefined, { value: "" }]) {
    const input = configured();
    if (entry) input.parameters.azureOpenAiImageAccountName = entry;
    else delete input.parameters.azureOpenAiImageAccountName;
    assert.throws(
      () => validateProductionImageProviderParameters(input),
      /azureOpenAiImageApiKeySecretUri requires azureOpenAiImageAccountName/u,
    );
  }
});

test("raw, malformed and unpinned image references fail without disclosing input", () => {
  for (const value of [
    "synthetic-raw-key-not-a-reference",
    secretUri.slice(0, secretUri.lastIndexOf("/")),
    secretUri.slice(0, -1),
    `${secretUri}?extra=value`,
    `${secretUri}#fragment`,
    secretUri.replace("https:", "http:"),
    secretUri.replace("https://", "https://username@"),
    secretUri.replace(".vault.azure.net", ".vault.azure.net.example.com"),
    `${secretUri}/`,
    ` ${secretUri}`,
  ]) {
    const input = configured();
    input.parameters.azureOpenAiImageApiKeySecretUri = { value };
    assert.throws(
      () => validateProductionImageProviderParameters(input),
      (error) => {
        assert.match(error.message, /versioned Key Vault secret URI/u);
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
});

test("unresolved fields and padded account names cannot silently select a fallback", () => {
  for (const name of ["azureOpenAiImageAccountName", "azureOpenAiImageApiKeySecretUri"]) {
    for (const entry of [null, { value: false }, { reference: { secretName: "unresolved" } }]) {
      const input = configured();
      input.parameters[name] = entry;
      assert.throws(() => validateProductionImageProviderParameters(input), /string value/u);
    }
  }
  for (const value of [" ", "fixture-images ", " fixture-images", "\tfixture-images"]) {
    const input = configured();
    input.parameters.azureOpenAiImageAccountName = { value };
    assert.throws(
      () => validateProductionImageProviderParameters(input),
      /azureOpenAiImageAccountName must not contain surrounding whitespace/u,
    );
  }
});

test("PLAN validates image references before writing while retaining billing/text guards", () => {
  const workflow = readFileSync(".github/workflows/validate-azure-production.yml", "utf8");
  const validation = "validateProductionImageProviderParameters({";
  assert.match(
    workflow,
    /import \{ validateProductionImageProviderParameters \} from "\.\/scripts\/azure\/production-image-provider-parameters\.mjs"/u,
  );
  assert.match(
    workflow,
    /Object\.assign\(document\.parameters, validateProductionImageProviderParameters\(\{\s+parameters: document\.parameters,\s+\}\)\);/u,
  );
  assert.ok(
    workflow.indexOf(validation) > workflow.indexOf("validateProductionTextProviderParameters({"),
  );
  assert.ok(
    workflow.indexOf(validation) > workflow.indexOf("validateProductionBillingParameters({"),
  );
  assert.ok(
    workflow.indexOf(validation) < workflow.indexOf("fs.writeFileSync(process.env.PARAMETERS_PATH"),
  );
  assert.doesNotMatch(
    workflow,
    /az deployment group create|az containerapp update|az keyvault secret set/u,
  );
});

test("the existing template retains key-reference and managed-identity paths", () => {
  const bicep = readFileSync("infra/azure/production/main.bicep", "utf8");
  assert.match(bicep, /@secure\(\)\s+param azureOpenAiImageApiKeySecretUri string = ''/u);
  assert.match(bicep, /var useDedicatedAzureOpenAiImage = !empty\(azureOpenAiImageAccountName\)/u);
  assert.match(
    bicep,
    /var useAzureOpenAiImageApiKey = useDedicatedAzureOpenAiImage && !empty\(azureOpenAiImageApiKeySecretUri\)/u,
  );
  assert.match(
    bicep,
    /var useAzureOpenAiImageManagedIdentity = useDedicatedAzureOpenAiImage && !useAzureOpenAiImageApiKey/u,
  );
  assert.match(bicep, /keyVaultUrl: azureOpenAiImageApiKeySecretUri\s+identity: identity\.id/u);
  assert.doesNotMatch(bicep, /name: 'AZURE_OPENAI_IMAGE_API_KEY'\s+value:/u);
});
