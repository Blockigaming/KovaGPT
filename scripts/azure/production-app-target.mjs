import { readFileSync } from "node:fs";

const APP_NAME = /^[a-z](?:[a-z0-9]|-(?!-)){0,29}[a-z0-9]$/u;
const GROUP_NAME = /^[-._()A-Za-z0-9]{1,90}$/u;
const SUBSCRIPTION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

export function validateProductionAppTarget({
  parameters,
  approvedName,
  resourceGroup,
  subscriptionId,
  observed,
}) {
  if (typeof approvedName !== "string" || !APP_NAME.test(approvedName)) {
    throw new Error("Invalid protected production Container App name");
  }
  if (typeof resourceGroup !== "string" || !GROUP_NAME.test(resourceGroup)) {
    throw new Error("Invalid protected production resource group");
  }
  if (typeof subscriptionId !== "string" || !SUBSCRIPTION_ID.test(subscriptionId)) {
    throw new Error("Invalid signed-in Azure subscription ID");
  }
  if (parameters?.containerAppName?.value !== approvedName) {
    throw new Error("Bicep Container App name differs from the protected target");
  }
  const expectedId =
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.App/containerApps/${approvedName}`;
  if (
    observed?.name !== approvedName ||
    observed?.type?.toLowerCase() !== "microsoft.app/containerapps" ||
    typeof observed?.id !== "string" ||
    observed.id.toLowerCase() !== expectedId.toLowerCase()
  ) {
    throw new Error("Existing Azure Container App identity differs from the protected target");
  }
  return { name: approvedName, id: expectedId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [parametersPath, observedPath, approvedName, resourceGroup, subscriptionId] =
    process.argv.slice(2);
  if (!parametersPath || !observedPath) throw new Error("Production target evidence is missing");
  const parameters = JSON.parse(readFileSync(parametersPath, "utf8")).parameters;
  const observed = JSON.parse(readFileSync(observedPath, "utf8"));
  const result = validateProductionAppTarget({
    parameters,
    approvedName,
    resourceGroup,
    subscriptionId,
    observed,
  });
  console.log(`Existing production Container App target verified: ${result.name}`);
}
