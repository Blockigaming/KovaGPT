import assert from "node:assert/strict";
import test from "node:test";
import {
  validateObservedProductionAcr,
  validateProductionParameterTargets,
} from "../../scripts/azure/production-plan-parameters.mjs";

const subscriptionId = "12345678-1234-1234-1234-123456789abc";
const acrName = "kovagptacr";
const acrResourceGroup = "rg-kovagpt-dev";
const acrLoginServer = "kovagptacr-dte9hugbhjghcyb8.azurecr.io";
const document = () => ({
  parameters: {
    acrResourceGroupName: { value: acrResourceGroup },
    keyVaultResourceGroupName: { value: "rg-kovagpt-prod" },
  },
});
const observed = () => ({
  id: `/subscriptions/${subscriptionId}/resourceGroups/${acrResourceGroup}/providers/Microsoft.ContainerRegistry/registries/${acrName}`,
  name: acrName,
  type: "Microsoft.ContainerRegistry/registries",
  loginServer: acrLoginServer,
});

test("PLAN permits the existing dev-named ACR group only when protected and observed", () => {
  assert.equal(
    validateProductionParameterTargets(document(), { acrResourceGroup }),
    acrResourceGroup,
  );
  assert.equal(
    validateObservedProductionAcr({
      observed: observed(),
      acrName,
      acrResourceGroup,
      acrLoginServer,
      subscriptionId,
    }).loginServer,
    acrLoginServer,
  );
});

test("PLAN rejects a dev target elsewhere or a mismatched protected ACR group", () => {
  for (const mutation of [
    (value) => (value.parameters.keyVaultResourceGroupName.value = acrResourceGroup),
    (value) => (value.parameters.otherName = { value: "SYNTHETIC_STAGING" }),
    (value) => (value.parameters.otherName = { value: "REPLACE_WITH_SECRET" }),
    (value) => (value.parameters.acrResourceGroupName.value = "rg-other"),
  ]) {
    const value = document();
    mutation(value);
    assert.throws(() => validateProductionParameterTargets(value, { acrResourceGroup }));
  }
  assert.throws(() => validateProductionParameterTargets(document(), { acrResourceGroup: "" }));
  assert.throws(() =>
    validateProductionParameterTargets(document(), { acrResourceGroup: "rg-kovagpt-dev." }),
  );
});

test("PLAN rejects a registry in another group or subscription and a DNS mismatch", () => {
  for (const mutation of [
    (value) => (value.id = value.id.replace("rg-kovagpt-dev", "rg-other")),
    (value) =>
      (value.id = value.id.replace(subscriptionId, "00000000-0000-0000-0000-000000000000")),
    (value) => (value.loginServer = "other.azurecr.io"),
    (value) => (value.type = "Microsoft.App/containerApps"),
    (value) => (value.name = "otheracr"),
  ]) {
    const value = observed();
    mutation(value);
    assert.throws(() =>
      validateObservedProductionAcr({
        observed: value,
        acrName,
        acrResourceGroup,
        acrLoginServer,
        subscriptionId,
      }),
    );
  }
});
