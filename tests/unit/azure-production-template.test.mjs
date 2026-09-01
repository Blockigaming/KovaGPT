import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("production Azure example is complete, inert, and production-scoped", () => {
  const source = read("infra/azure/production/main.parameters.example.json");
  const parameters = JSON.parse(source).parameters;

  for (const name of [
    "imageReference",
    "keyVaultName",
    "supabaseServiceRoleSecretUri",
    "kovaIpHashSecretUri",
    "azureOpenAiAccountName",
    "supabaseUrl",
    "supabasePublishableKey",
    "cloudflareClientCertificateSha256Fingerprints",
  ]) {
    assert.ok(Object.hasOwn(parameters, name), `missing production parameter: ${name}`);
  }

  for (const name of [
    "managedEnvironmentName",
    "managedIdentityName",
    "logAnalyticsWorkspaceName",
    "acrName",
    "acrResourceGroupName",
    "keyVaultName",
    "keyVaultResourceGroupName",
    "azureOpenAiAccountName",
    "azureOpenAiResourceGroupName",
  ]) {
    assert.match(parameters[name].value, /^REPLACE_WITH_PRODUCTION_/u);
  }

  assert.doesNotMatch(source, /STAGING|SYNTHETIC_STAGING|rg-kovagpt-dev/iu);
  assert.equal(
    parameters.imageReference.value,
    "REPLACE_WITH_PRODUCTION_ACR_LOGIN_SERVER/kovagpt-web@sha256:REPLACE_WITH_64_HEX_DIGEST",
  );
  assert.match(
    parameters.supabaseServiceRoleSecretUri.value,
    /^https:\/\/REPLACE_WITH_PRODUCTION_KEY_VAULT\.vault\.azure\.net\/secrets\/supabase-service-role-key\/REPLACE_WITH_VERSION$/u,
  );
  assert.match(
    parameters.kovaIpHashSecretUri.value,
    /^https:\/\/REPLACE_WITH_PRODUCTION_KEY_VAULT\.vault\.azure\.net\/secrets\/kova-ip-hash-secret\/REPLACE_WITH_VERSION$/u,
  );
  assert.equal(parameters.generationEnabled.value, false);
  assert.equal(parameters.minReplicas.value, 1);
  assert.equal(parameters.deployBudget.value, false);
  assert.deepEqual(parameters.cloudflareClientCertificateSha256Fingerprints.value, [
    "REPLACE_WITH_64_HEX_CLOUDFLARE_CLIENT_CERT_SHA256",
  ]);

  const bicep = read("infra/azure/production/main.bicep");
  assert.match(bicep, /param kovaIpHashSecretUri string/u);
  assert.match(bicep, /keyVaultUrl: kovaIpHashSecretUri/u);
  assert.match(bicep, /secretRef: 'kova-ip-hash-secret'/u);
  assert.match(bicep, /clientCertificateMode: 'require'/u);
  assert.match(bicep, /param cloudflareClientCertificateSha256Fingerprints array/u);
  assert.match(bicep, /name: 'KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS'/u);
  assert.match(bicep, /join\(cloudflareClientCertificateSha256Fingerprints, ','\)/u);
  assert.equal((bicep.match(/tcpSocket:/gu) ?? []).length, 3);
  for (const type of ["Startup", "Liveness", "Readiness"]) {
    assert.match(bicep, new RegExp(`type: '${type}'[\\s\\S]*?tcpSocket:`, "u"));
  }
  assert.doesNotMatch(bicep, /httpGet:/u);

  const exampleEnv = read(".env.example");
  assert.match(exampleEnv, /^KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS=$/mu);
});
