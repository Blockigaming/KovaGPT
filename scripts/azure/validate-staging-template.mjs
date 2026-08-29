import assert from "node:assert/strict";
import {
  compileBicepWhenAvailable,
  readTemplatePair,
  requireMatch,
  rejectMatch,
  validateCommonAzureTemplate,
} from "./template-contract.mjs";

export function validateAzureStagingTemplate() {
  const pair = readTemplatePair("staging");
  const { template, parameters } = pair;
  const { values } = validateCommonAzureTemplate({ template, parameters, environment: "staging" });

  requireMatch(template, /param minReplicas int = 0/u, "staging must scale to zero by default");
  requireMatch(template, /param maxReplicas int = 2/u, "staging scale-out must be bounded");
  requireMatch(
    template,
    /param restrictIngress bool = false/u,
    "staging ingress restriction must be configurable",
  );
  requireMatch(
    template,
    /ipSecurityRestrictions: restrictIngress \? (?:\[for|stagingIpSecurityRestrictions)/u,
    "staging CIDR restrictions are missing",
  );
  requireMatch(
    template,
    /resource environment 'Microsoft\.App\/managedEnvironments@2025-01-01'/u,
    "staging environment must be isolated",
  );
  requireMatch(
    template,
    /resource identity 'Microsoft\.ManagedIdentity\/userAssignedIdentities@2023-01-31'/u,
    "staging identity must be isolated",
  );
  requireMatch(template, /workspaceCapping/u, "staging log cap is missing");
  requireMatch(template, /logRetentionDays/u, "staging log retention is missing");
  requireMatch(
    template,
    /resource budget 'Microsoft\.Consumption\/budgets@2024-08-01' = if \(deployBudget\)/u,
    "staging budget must be available",
  );
  requireMatch(
    template,
    /name: 'KOVA_PUBLIC_URL'[\s\S]*?value: publicBaseUrl/u,
    "staging runtime must receive KOVA_PUBLIC_URL",
  );

  assert.equal(values.minReplicas?.value, 0, "staging example must scale to zero");
  assert.equal(values.maxReplicas?.value, 2, "staging example max replicas must remain bounded");
  assert.equal(
    values.publicBaseUrl?.value,
    "https://staging.kovagpt.com",
    "staging base URL is wrong",
  );
  rejectMatch(
    parameters,
    /mfbycmbjygcfkrsuepxf/u,
    "real production Supabase project is prohibited in staging example",
  );

  const compilation = compileBicepWhenAvailable(pair.templatePath);
  return {
    environment: "staging",
    runtime: "azure-container-apps-node-server",
    isolatedIdentity: true,
    isolatedObservability: true,
    scaleToZero: true,
    scheduledJobDefined: true,
    publicUrlConfigured: true,
    zeroLovable: true,
    ...compilation,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    `AZURE_STAGING_TEMPLATE_VALIDATION=${JSON.stringify(validateAzureStagingTemplate())}`,
  );
}
