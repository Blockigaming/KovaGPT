import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateProductionAppTarget } from "../../scripts/azure/production-app-target.mjs";

const input = () => ({
  parameters: { containerAppName: { value: "ca-kovagpt-prod" } },
  approvedName: "ca-kovagpt-prod",
  resourceGroup: "rg-kovagpt-prod",
  subscriptionId: "12345678-1234-1234-1234-123456789abc",
  observed: {
    name: "ca-kovagpt-prod",
    type: "Microsoft.App/containerApps",
    id: "/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/ca-kovagpt-prod",
  },
});

test("production PLAN binds protected target to an existing app in the signed-in subscription", () => {
  assert.equal(validateProductionAppTarget(input()).name, "ca-kovagpt-prod");
  for (const mutation of [
    (value) => (value.parameters.containerAppName.value = "other-prod"),
    (value) => (value.parameters.containerAppName = undefined),
    (value) => (value.observed.name = "other-prod"),
    (value) => (value.observed.type = "Microsoft.App/jobs"),
    (value) => (value.observed.id = value.observed.id.replace("rg-kovagpt-prod", "rg-other")),
    (value) =>
      (value.observed.id = value.observed.id.replace(
        value.subscriptionId,
        "00000000-0000-0000-0000-000000000000",
      )),
    (value) => (value.observed.id = value.observed.id.replace("ca-kovagpt-prod", "other-prod")),
  ]) {
    const value = input();
    mutation(value);
    assert.throws(() => validateProductionAppTarget(value));
  }
});

test("production PLAN rejects invalid or absent protected identities", () => {
  for (const name of ["", "Other-App", "ca--prod", "ca-prod/other", "1-prod", "a".repeat(32)]) {
    const value = input();
    value.approvedName = name;
    assert.throws(() => validateProductionAppTarget(value));
  }
  for (const [field, invalid] of [
    ["resourceGroup", ""],
    ["resourceGroup", "prod/other"],
    ["subscriptionId", "not-a-subscription"],
  ]) {
    const value = input();
    value[field] = invalid;
    assert.throws(() => validateProductionAppTarget(value));
  }
});

test("production PLAN source remains read-only and Bicep requires an exact app name", () => {
  const bicep = readFileSync("infra/azure/production/main.bicep", "utf8");
  const workflow = readFileSync(".github/workflows/validate-azure-production.yml", "utf8");
  const example = JSON.parse(
    readFileSync("infra/azure/production/main.parameters.example.json", "utf8"),
  );
  assert.match(bicep, /param containerAppName string\s/u);
  assert.match(
    bicep,
    /resource webApp 'Microsoft\.App\/containerApps@[^']+' = \{\s+name: containerAppName/u,
  );
  assert.doesNotMatch(bicep, /var webAppName =/u);
  assert.equal(
    example.parameters.containerAppName.value,
    "REPLACE_WITH_PRODUCTION_CONTAINER_APP_NAME",
  );
  assert.match(workflow, /az resource show/u);
  assert.match(workflow, /scripts\/azure\/production-app-target\.mjs/u);
  assert.match(workflow, /Azure CLI 2\.76\.0 or later is required/u);
  assert.equal((workflow.match(/--validation-level ProviderNoRbac/gu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /az deployment group create|az containerapp update/u);
});
