const RESOURCE_GROUP = /^[-._()A-Za-z0-9]{1,90}$/u;
const RESOURCE_NAME = /^[a-z0-9]{5,50}$/u;
const SUBSCRIPTION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

export function validateProductionParameterTargets(document, { acrResourceGroup }) {
  if (
    typeof acrResourceGroup !== "string" ||
    !RESOURCE_GROUP.test(acrResourceGroup) ||
    acrResourceGroup.endsWith(".") ||
    document?.parameters?.acrResourceGroupName?.value !== acrResourceGroup
  ) {
    throw new Error("The protected ACR resource group differs from the Bicep target");
  }

  // This existing registry lives in the dev-named resource group. Only that
  // one reviewed field may contain its name; other development targets still
  // fail the protected production parameter check.
  const checked = structuredClone(document);
  checked.parameters.acrResourceGroupName = { value: "VERIFIED_PROTECTED_ACR_RESOURCE_GROUP" };
  if (/REPLACE_WITH|SYNTHETIC_STAGING|rg-kovagpt-dev/iu.test(JSON.stringify(checked))) {
    throw new Error("The protected production parameters contain a placeholder or dev target");
  }
  return acrResourceGroup;
}

export function validateObservedProductionAcr({
  observed,
  acrName,
  acrResourceGroup,
  acrLoginServer,
  subscriptionId,
}) {
  if (
    !RESOURCE_NAME.test(acrName ?? "") ||
    !RESOURCE_GROUP.test(acrResourceGroup ?? "") ||
    !SUBSCRIPTION_ID.test(subscriptionId ?? "") ||
    typeof acrLoginServer !== "string" ||
    !/^[a-z0-9][a-z0-9.-]*\.azurecr\.io$/u.test(acrLoginServer)
  ) {
    throw new Error("The protected ACR identity is invalid");
  }
  const expectedId =
    `/subscriptions/${subscriptionId}/resourceGroups/${acrResourceGroup}` +
    `/providers/Microsoft.ContainerRegistry/registries/${acrName}`;
  if (
    typeof observed?.id !== "string" ||
    observed.id.toLowerCase() !== expectedId.toLowerCase() ||
    observed.name !== acrName ||
    observed.loginServer !== acrLoginServer ||
    observed.type?.toLowerCase() !== "microsoft.containerregistry/registries"
  ) {
    throw new Error("The existing ACR identity differs from the protected production target");
  }
  return { id: expectedId, loginServer: acrLoginServer };
}
