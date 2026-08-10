import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateAzureStagingTemplate } from "../../scripts/azure/validate-staging-template.mjs";

test("low-cost staging template passes the fail-closed validator", () => {
  assert.deepEqual(validateAzureStagingTemplate(), {
    browserConfigIsBuildVerified: true,
    containerAppApi: "2025-01-01",
    generationEnabled: false,
    maxReplicas: 2,
    scaleToZero: true,
    imageUsesDigest: true,
    zeroLovable: true,
  });
});

test("validator rejects Lovable, mutable image, production target, and enabled generation drift", async () => {
  const template = await readFile("infra/azure/staging/main.bicep", "utf8");
  const parameters = await readFile("infra/azure/staging/main.parameters.example.json", "utf8");

  assert.throws(() =>
    validateAzureStagingTemplate({
      template: `${template}\n// LOVABLE_API_KEY`,
      parameters,
    }),
  );
  assert.throws(() =>
    validateAzureStagingTemplate({
      template: template.replace(
        "param generationEnabled bool = false",
        "param generationEnabled bool = true",
      ),
      parameters,
    }),
  );
  assert.throws(() =>
    validateAzureStagingTemplate({
      template: `${template}\n// ca-kovagpt-dev`,
      parameters,
    }),
  );
  assert.throws(() =>
    validateAzureStagingTemplate({
      template,
      parameters: parameters.replace("@sha256:", ":latest"),
    }),
  );
});

test("template uses Key Vault and managed identity instead of secret values", async () => {
  const template = await readFile("infra/azure/staging/main.bicep", "utf8");
  assert.match(template, /type: 'UserAssigned'/u);
  assert.match(template, /keyVaultUrl: openAiSecretUri/u);
  assert.match(template, /keyVaultUrl: supabaseServiceRoleSecretUri/u);
  assert.match(template, /identity: identity\.id/u);
  assert.match(template, /roleDefinitionId: acrPullRoleDefinitionId/u);
  assert.match(template, /roleDefinitionId: keyVaultSecretsUserRoleDefinitionId/u);
  assert.doesNotMatch(template, /value: openAiSecretUri|value: supabaseServiceRoleSecretUri/u);
});

test("runtime configuration cannot pretend to change the compiled browser backend", async () => {
  const template = await readFile("infra/azure/staging/main.bicep", "utf8");
  const parameters = await readFile("infra/azure/staging/main.parameters.example.json", "utf8");

  assert.doesNotMatch(template, /name: 'VITE_SUPABASE_(?:URL|PUBLISHABLE_KEY)'/u);
  assert.match(
    template,
    /image reference built and verified with the synthetic staging browser Supabase configuration/iu,
  );
  assert.throws(() =>
    validateAzureStagingTemplate({
      template: template.replace(
        "            {\n              name: 'SUPABASE_PUBLISHABLE_KEY'",
        "            {\n              name: 'VITE_SUPABASE_URL'\n              value: supabaseUrl\n            }\n            {\n              name: 'SUPABASE_PUBLISHABLE_KEY'",
      ),
      parameters,
    }),
  );
  assert.throws(() =>
    validateAzureStagingTemplate({
      template: template.replace(
        "Immutable ACR image reference built and verified with the synthetic staging browser Supabase configuration.",
        "Immutable ACR image reference.",
      ),
      parameters,
    }),
  );
});

test("template establishes cost containment and honest staging defaults", async () => {
  const template = await readFile("infra/azure/staging/main.bicep", "utf8");
  assert.match(template, /param minReplicas int = 0/u);
  assert.match(template, /param maxReplicas int = 2/u);
  assert.match(template, /param monthlyBudgetAmount int = 25/u);
  assert.match(template, /resource budget[\s\S]*if \(deployBudget\)/u);
  assert.match(template, /AI_GENERATION_ENABLED[\s\S]*generationEnabled \? 'true' : 'false'/u);
  assert.match(template, /KOVA_GENERATION_DISABLED[\s\S]*generationEnabled \? 'false' : 'true'/u);
});
