import assert from "node:assert/strict";
import {
  compileBicepWhenAvailable,
  readTemplatePair,
  requireMatch,
  rejectMatch,
  validateCommonAzureTemplate,
} from "./template-contract.mjs";

export function validateAzureProductionTemplate() {
  const pair = readTemplatePair("production");
  const { template, parameters } = pair;
  const { values } = validateCommonAzureTemplate({
    template,
    parameters,
    environment: "production",
  });

  requireMatch(template, /param minReplicas int = 1/u, "production must keep one warm replica");
  requireMatch(template, /param maxReplicas int = 4/u, "production scale-out must be bounded");
  requireMatch(
    template,
    /@minLength\(1\)\s*param cloudflareOriginCidrs array/su,
    "Cloudflare origin CIDRs are required",
  );
  requireMatch(
    template,
    /var originCidrs = concat\(cloudflareOriginCidrs, temporaryOriginVerificationCidrs\)/u,
    "origin CIDRs must be explicit",
  );
  requireMatch(
    template,
    /ipSecurityRestrictions: \[for \(cidr, index\) in originCidrs:/u,
    "Azure origin must be restricted to Cloudflare and explicit verification CIDRs",
  );
  requireMatch(
    template,
    /temporaryOriginVerificationCidrsCount/u,
    "temporary origin access must be observable",
  );
  requireMatch(
    template,
    /resource environment 'Microsoft\.App\/managedEnvironments@2025-01-01' existing/u,
    "production must use the approved existing environment",
  );
  requireMatch(
    template,
    /resource identity 'Microsoft\.ManagedIdentity\/userAssignedIdentities@2023-01-31' existing/u,
    "production must use the approved existing identity",
  );
  requireMatch(
    template,
    /resource workspace 'Microsoft\.OperationalInsights\/workspaces@2023-09-01' existing/u,
    "production must use the approved existing workspace",
  );
  requireMatch(
    template,
    /resource budget 'Microsoft\.Consumption\/budgets@2024-08-01' = if \(deployBudget\)/u,
    "production budget must be available",
  );
  requireMatch(
    template,
    /output deployedSourceSha string = sourceSha/u,
    "source SHA evidence is missing",
  );
  requireMatch(
    template,
    /output deployedSourceTree string = sourceTree/u,
    "source tree evidence is missing",
  );
  requireMatch(
    template,
    /name: 'KOVA_PUBLIC_URL'[\s\S]*?value: publicBaseUrl/u,
    "production runtime must receive KOVA_PUBLIC_URL",
  );

  assert.equal(values.minReplicas?.value, 1, "production example must keep one replica");
  assert.equal(values.maxReplicas?.value, 4, "production example max replicas must remain bounded");
  assert.equal(
    values.temporaryOriginVerificationCidrs?.value?.length,
    0,
    "production example cannot keep bypass CIDRs",
  );
  assert.ok(
    (values.cloudflareOriginCidrs?.value?.length ?? 0) >= 1,
    "production example must show Cloudflare CIDRs",
  );
  assert.equal(values.publicBaseUrl?.value, "https://kovagpt.com", "production base URL is wrong");
  rejectMatch(
    parameters,
    /STAGING|synthetic/iu,
    "production parameters cannot use staging placeholders",
  );

  const compilation = compileBicepWhenAvailable(pair.templatePath);
  return {
    environment: "production",
    runtime: "azure-container-apps-node-server",
    imageUsesDigest: true,
    exactSourceIdentity: true,
    managedIdentityRbac: true,
    keyVaultReferences: true,
    cloudflareOnlyOrigin: true,
    scheduledJobDefined: true,
    dedicatedScheduledWorker: true,
    schedulerAlertsDefined: true,
    applicationInsights: true,
    publicUrlConfigured: true,
    zeroLovable: true,
    ...compilation,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    `AZURE_PRODUCTION_TEMPLATE_VALIDATION=${JSON.stringify(validateAzureProductionTemplate())}`,
  );
}
