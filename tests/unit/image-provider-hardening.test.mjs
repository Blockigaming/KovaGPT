import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("production IaC preserves a dedicated image provider across deployments", () => {
  const bicep = read("infra/azure/production/main.bicep");
  const parameters = JSON.parse(
    read("infra/azure/production/main.parameters.example.json"),
  ).parameters;

  for (const name of [
    "azureOpenAiImageAccountName",
    "azureOpenAiImageResourceGroupName",
    "azureOpenAiImageApiKeySecretUri",
  ]) {
    assert.match(bicep, new RegExp(`param ${name} string`, "u"));
    assert.ok(Object.hasOwn(parameters, name), `missing production parameter: ${name}`);
  }

  assert.match(bicep, /resource azureOpenAiImage .* existing = if/u);
  assert.match(bicep, /name: 'AZURE_OPENAI_IMAGE_ENDPOINT'/u);
  assert.match(bicep, /value: azureOpenAiImage\.properties\.endpoint/u);
  assert.match(bicep, /name: 'AZURE_OPENAI_IMAGE_API_KEY'/u);
  assert.match(bicep, /secretRef: 'azure-openai-image-api-key'/u);
  assert.match(bicep, /keyVaultUrl: azureOpenAiImageApiKeySecretUri/u);
  assert.match(
    bicep,
    /resource azureOpenAiImageUser 'Microsoft\.Authorization\/roleAssignments@2022-04-01' = if/u,
  );
  assert.match(bicep, /scope: azureOpenAiImage/u);
  assert.match(bicep, /roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId/u);

  const migration = read("docs/azure/MIGRATION.md");
  assert.match(migration, /`azureOpenAiImageAccountName`/u);
  assert.match(migration, /`azureOpenAiImageApiKeySecretUri`/u);
});

test("image readiness validates the capability-specific target", () => {
  const provider = read("src/lib/ai/provider.server.ts");
  const readiness = read("src/lib/readiness.server.ts");

  assert.match(provider, /export function providerCapabilityConfigured/u);
  assert.match(provider, /const target = providerTarget\(capability\)/u);
  assert.match(provider, /if \(target\.auth === "missing"\) return false/u);
  assert.match(provider, /Boolean\(env\("AZURE_OPENAI_DEPLOYMENT_IMAGE"\)\)/u);
  assert.match(
    readiness,
    /images: capability\(providerCapabilityConfigured\("image_generation"\)\)/u,
  );
  assert.doesNotMatch(readiness, /images: capability\(aiProviderConfigured\(\)\)/u);
});

test("both image routes reject an unavailable target before consuming quota", () => {
  const route = read("src/routes/api/generate-image.ts");
  const chat = read("src/routes/api/chat.ts");
  const dedicatedPreflight = 'providerUnavailableResponse("image_generation")';

  const routePreflight = route.indexOf(dedicatedPreflight);
  const routeQuota = route.indexOf('enforceQuota(auth, "images"');
  assert.ok(routePreflight > -1 && routePreflight < routeQuota);

  const imageBranch = chat.indexOf("if (isImageRequest && auth)");
  const chatPreflight = chat.indexOf(dedicatedPreflight, imageBranch);
  const chatQuota = chat.indexOf('preflight.run("image_quota"', imageBranch);
  assert.ok(imageBranch > -1 && chatPreflight > imageBranch && chatPreflight < chatQuota);
});

test("release scanners detect the dedicated Azure image API key value", () => {
  for (const path of ["scripts/release/security.mjs", "scripts/security/scan-ai-runtime.mjs"]) {
    const source = read(path);
    assert.match(source, /"AZURE_OPENAI_IMAGE_API_KEY"/u, path);
    assert.match(source, /source\.includes\(value\)/u, path);
  }
});
