import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProductionBillingParameters } from "../../scripts/azure/production-billing-parameters.mjs";

const browserKey = `pk_live_${"a".repeat(32)}`;
const secretUri = `https://production-vault.vault.azure.net/secrets/existing-name/${"a".repeat(32)}`;
const fingerprint = createHash("sha256").update(browserKey).digest("hex");
function configured() {
  return {
    parameters: {
      keyVaultName: { value: "production-vault" },
      stripeBillingRuntime: { value: "durable" },
      stripeLiveApiKeySecretUri: { value: secretUri },
      stripeLiveWebhookSecretUri: { value: secretUri.replace("existing-name", "existing-webhook") },
    },
    provenance: { stripePublishableKeySha256: fingerprint },
    stripePublishableKey: browserKey,
  };
}

test("production billing remains disabled with no credentials configured", () => {
  const parameters = { keyVaultName: { value: "production-vault" } };
  const result = validateProductionBillingParameters({
    parameters,
    provenance: { stripePublishableKeySha256: null },
  });
  assert.equal(result.stripeBillingRuntime.value, "disabled");
  assert.equal(result.stripeLiveAccountId.value, "acct_1UAeDgAEZlsb6DBY");
  assert.equal(result.stripeBillingPortalConfigurationId.value, "bpc_1UB2ZxAEZlsb6DBYU3PoJJPU");
  assert.equal(result.stripeLiveApiKeySecretUri.value, "");
  assert.equal(Object.hasOwn(parameters, "stripeBillingRuntime"), false);
});

test("durable planning requires matching compiled key and both versioned live references", () => {
  assert.equal(
    validateProductionBillingParameters(configured()).stripeBillingRuntime.value,
    "durable",
  );
  for (const name of ["stripeLiveApiKeySecretUri", "stripeLiveWebhookSecretUri"]) {
    const input = configured();
    delete input.parameters[name];
    assert.throws(() => validateProductionBillingParameters(input), /both live secret references/u);
  }
  const input = configured();
  input.stripePublishableKey = "";
  input.provenance.stripePublishableKeySha256 = null;
  assert.throws(() => validateProductionBillingParameters(input), /verified browser key/u);
});

test("old or mismatched browser provenance cannot pass even with billing disabled", () => {
  for (const provenance of [{}, { stripePublishableKeySha256: "b".repeat(64) }]) {
    assert.throws(
      () => validateProductionBillingParameters({ parameters: {}, provenance }),
      /fingerprint does not match/u,
    );
  }
  const input = configured();
  input.stripePublishableKey = `pk_live_${"b".repeat(32)}`;
  assert.throws(() => validateProductionBillingParameters(input), /fingerprint does not match/u);
});

test("production rejects test keys, secret keys and unapproved account or Portal identities", () => {
  for (const value of [
    `pk_test_${"a".repeat(32)}`,
    `rk_live_${"a".repeat(32)}`,
    ` ${browserKey}`,
    null,
  ]) {
    assert.throws(
      () => validateProductionBillingParameters({ ...configured(), stripePublishableKey: value }),
      /live publishable key/u,
    );
  }
  for (const [name, value] of [
    ["stripeLiveAccountId", "acct_other"],
    ["stripeBillingPortalConfigurationId", "bpc_other"],
    ["stripeBillingRuntime", "enabled"],
  ]) {
    const input = configured();
    input.parameters[name] = { value };
    assert.throws(
      () => validateProductionBillingParameters(input),
      /not approved|disabled or durable/u,
    );
  }
});

test("raw credentials, unversioned, foreign-vault and malformed references fail without value disclosure", () => {
  for (const value of [
    `rk_live_${"s".repeat(32)}`,
    secretUri.replace("production-vault", "another-vault"),
    secretUri.slice(0, secretUri.lastIndexOf("/")),
    `${secretUri}?version=other`,
    secretUri.replace("https:", "http:"),
    `${secretUri}/`,
  ]) {
    const input = configured();
    input.parameters.stripeLiveApiKeySecretUri = { value };
    assert.throws(
      () => validateProductionBillingParameters(input),
      (error) => {
        assert.match(error.message, /versioned secret URI/u);
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
  const input = configured();
  input.parameters.stripeSandboxApiKeySecretUri = { value: secretUri };
  assert.equal(
    validateProductionBillingParameters(input).stripeSandboxApiKeySecretUri.value,
    secretUri,
  );
  input.parameters.stripeLiveApiKeySecretUri = { reference: { secretName: "unresolved" } };
  assert.throws(() => validateProductionBillingParameters(input), /string value/u);
});

test("production source connects approved parameters to existing identity and keeps planning non-deploying", () => {
  const read = (path) => readFileSync(path, "utf8");
  const bicep = read("infra/azure/production/main.bicep");
  const parameters = JSON.parse(
    read("infra/azure/production/main.parameters.example.json"),
  ).parameters;
  const workflow = read(".github/workflows/validate-azure-production.yml");
  assert.equal(parameters.stripeBillingRuntime.value, "disabled");
  assert.equal(parameters.stripeLiveApiKeySecretUri.value, "");
  assert.match(bicep, /param stripeBillingRuntime string = 'disabled'/u);
  assert.match(bicep, /name: 'STRIPE_BILLING_RUNTIME'\s+value: stripeBillingRuntime/u);
  for (const name of [
    "STRIPE_LIVE_API_KEY",
    "PAYMENTS_LIVE_WEBHOOK_SECRET",
    "STRIPE_SANDBOX_API_KEY",
    "PAYMENTS_SANDBOX_WEBHOOK_SECRET",
  ]) {
    assert.ok(bicep.includes(`envName: '${name}'`));
  }
  assert.match(bicep, /keyVaultUrl: setting\.uri\s+identity: identity\.id/u);
  assert.match(bicep, /name: setting\.envName\s+secretRef: setting\.name/u);
  assert.doesNotMatch(
    bicep,
    /Microsoft\.KeyVault\/vaults\/secrets@|Microsoft\.Authorization\/roleAssignments@/u,
  );
  assert.match(workflow, /validateProductionBillingParameters\(\{/u);
  assert.match(
    workflow,
    /KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: \$\{\{ vars\.KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY \}\}/u,
  );
  assert.match(workflow, /az deployment group validate/u);
  assert.match(workflow, /az deployment group what-if/u);
  assert.doesNotMatch(
    workflow,
    /az deployment group create|az containerapp update|az keyvault secret set/u,
  );
});
