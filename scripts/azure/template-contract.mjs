import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export function requireMatch(source, pattern, description) {
  assert.match(source, pattern, description);
}

export function rejectMatch(source, pattern, description) {
  assert.doesNotMatch(source, pattern, description);
}

export function readTemplatePair(environment) {
  const templatePath = `infra/azure/${environment}/main.bicep`;
  const parametersPath = `infra/azure/${environment}/main.parameters.example.json`;
  return {
    templatePath,
    parametersPath,
    template: readFileSync(templatePath, "utf8"),
    parameters: readFileSync(parametersPath, "utf8"),
  };
}

export function validateCommonAzureTemplate({ template, parameters, environment }) {
  const parsedParameters = JSON.parse(parameters);
  const values = parsedParameters.parameters ?? {};

  requireMatch(
    template,
    /resource webApp 'Microsoft\.App\/containerApps@2025-01-01'/u,
    `${environment} web app must use the reviewed Container Apps API`,
  );
  requireMatch(
    template,
    /resource scheduledJob 'Microsoft\.App\/jobs@2025-01-01' = if \(deployScheduledJob\)/u,
    `${environment} scheduled job is required`,
  );
  requireMatch(
    template,
    /resource azureOpenAi 'Microsoft\.CognitiveServices\/accounts@2024-10-01' existing/u,
    "Azure OpenAI must be explicitly scoped",
  );
  requireMatch(template, /activeRevisionsMode: 'Single'/u, "single-revision mode is required");
  requireMatch(template, /allowInsecure: false/u, "HTTPS-only ingress is required");
  requireMatch(template, /targetPort: 3000/u, "container target port is required");
  requireMatch(template, /path: '\/api\/health'/u, "health probes are required");
  requireMatch(template, /type: 'Readiness'/u, "readiness probe is required");
  requireMatch(
    template,
    /path: (?:generationEnabled \? '\/api\/readyz' : '\/api\/health'|'\/api\/readyz')/u,
    "readiness must be provider-aware",
  );

  for (const role of [
    "7f951dda-4ed3-4680-a7ca-43fe172d538d",
    "4633458b-17de-408a-b874-0445c86b69e6",
    "5e0bd9bd-7b93-4f28-af87-19fc36ad61bd",
  ]) {
    requireMatch(template, new RegExp(role, "u"), `required role assignment ${role} is missing`);
  }
  for (const resource of ["acrPull", "keyVaultSecretsUser", "azureOpenAiUser"]) {
    requireMatch(
      template,
      new RegExp(
        `resource ${resource} 'Microsoft\\.Authorization/roleAssignments@2022-04-01'`,
        "u",
      ),
      `${resource} role assignment is missing`,
    );
  }

  for (const param of [
    "supabaseServiceRoleSecretUri",
    "kovaIpHashSecretUri",
    "scheduledExecutionSecretUri",
    "additionalKeyVaultSecretBindings",
    "supabasePublishableKey",
  ]) {
    requireMatch(
      template,
      new RegExp(`@secure\\(\\)\\s*param ${param} `, "su"),
      `${param} must be a secure Bicep parameter`,
    );
  }
  requireMatch(
    template,
    /keyVaultUrl: supabaseServiceRoleSecretUri/u,
    "Supabase service role must use Key Vault",
  );
  requireMatch(
    template,
    /secretRef: 'supabase-service-role-key'/u,
    "Supabase service role env must use a secret reference",
  );
  requireMatch(
    template,
    /keyVaultUrl: scheduledExecutionSecretUri/u,
    "scheduler token must use Key Vault",
  );
  requireMatch(
    template,
    /secretRef: 'scheduled-execution-secret'/u,
    "scheduler env must use a secret reference",
  );
  requireMatch(
    template,
    /certificateKeyVaultProperties/u,
    "custom-domain certificate must come from Key Vault",
  );

  for (const env of [
    "KOVA_RUNTIME_PLATFORM",
    "KOVA_CLOUDFLARE_EDGE_ONLY",
    "KOVA_NITRO_PRESET",
    "KOVA_BUILD_SHA",
    "KOVA_SOURCE_SHA",
    "KOVA_SOURCE_TREE",
    "KOVA_EXPECTED_SUPABASE_PROJECT_REF",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_CLIENT_ID",
    "AZURE_OPENAI_USE_MANAGED_IDENTITY",
    "AZURE_OPENAI_DEPLOYMENT_CHAT",
    "AZURE_OPENAI_DEPLOYMENT_THINKING",
    "AZURE_OPENAI_DEPLOYMENT_DEEP",
    "AZURE_OPENAI_DEPLOYMENT_IMAGE",
    "AZURE_OPENAI_DEPLOYMENT_EMBEDDING",
    "APPLICATIONINSIGHTS_CONNECTION_STRING",
  ]) {
    requireMatch(template, new RegExp(`name: '${env}'`, "u"), `${env} is missing`);
  }
  requireMatch(
    template,
    /value: 'azure-container-apps'/u,
    "runtime platform must be Azure Container Apps",
  );
  requireMatch(template, /value: 'node-server'/u, "Nitro runtime must be Node server");
  requireMatch(template, /value: 'gpt-5\.6-sol'/u, "Kova deep model alias must be gpt-5.6-sol");
  requireMatch(
    template,
    /identity: identity\.id/u,
    "ACR and Key Vault must use the managed identity",
  );
  requireMatch(
    template,
    /server: acr\.properties\.loginServer/u,
    "ACR registry must be managed-identity backed",
  );
  requireMatch(
    template,
    /image: imageReference/u,
    "the container must use the immutable image parameter",
  );
  requireMatch(template, /KOVA_SCHEDULED_EXECUTION_ENDPOINT/u, "scheduled job endpoint is missing");
  requireMatch(
    template,
    /authorization: `Bearer \$\{token\}`/u,
    "scheduler must authenticate with a bearer token",
  );
  requireMatch(template, /scheduleTriggerConfig/u, "scheduled trigger configuration is missing");
  requireMatch(
    template,
    /cronExpression: schedulerCronExpression/u,
    "scheduler cron must be explicit",
  );
  requireMatch(
    template,
    /APPLICATIONINSIGHTS_CONNECTION_STRING/u,
    "Application Insights wiring is missing",
  );

  rejectMatch(
    template,
    /@lovable\.dev|LOVABLE_|lovable\.(?:app|dev)|ai\.gateway\.lovable\.dev/iu,
    "Lovable dependency is prohibited",
  );
  rejectMatch(
    template,
    /cloudflare-module|wrangler/iu,
    "Cloudflare runtime deployment is prohibited",
  );
  rejectMatch(template, /OPENAI_API_KEY|AZURE_OPENAI_API_KEY/iu, "Azure OpenAI must be keyless");
  rejectMatch(template, /latest\b|:main\b|:production\b/iu, "mutable image tags are prohibited");
  rejectMatch(
    template,
    /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/iu,
    "TLS bypass is prohibited",
  );

  assert.match(
    values.imageReference?.value ?? "",
    /@sha256:/u,
    "example image must be digest-pinned",
  );
  assert.match(
    values.sourceSha?.value ?? "",
    /40_CHARACTER_RELEASE_SHA/u,
    "example source SHA placeholder is required",
  );
  assert.match(
    values.sourceTree?.value ?? "",
    /40_CHARACTER_GIT_TREE/u,
    "example source tree placeholder is required",
  );
  assert.equal(values.generationEnabled?.value, false, "example generation must remain disabled");
  assert.equal(
    values.deployScheduledJob?.value,
    false,
    "example scheduler must require an explicit enable",
  );
  assert.equal(
    values.bindCustomDomains?.value,
    false,
    "example custom-domain binding must require an explicit enable",
  );

  rejectMatch(
    parameters,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/u,
    "OpenAI key is prohibited",
  );
  rejectMatch(parameters, /\bsb_secret_[A-Za-z0-9_-]{20,}/u, "Supabase secret is prohibited");
  rejectMatch(parameters, /lovable\.(?:app|dev)|LOVABLE_/iu, "Lovable configuration is prohibited");

  return { values };
}

export function compileBicepWhenAvailable(templatePath) {
  if (!process.argv.includes("--compile")) return { compiled: false, reason: "not_requested" };
  try {
    execFileSync("az", ["bicep", "build", "--file", templatePath, "--stdout"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return { compiled: true };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("--compile requires Azure CLI with Bicep installed");
    }
    throw error;
  }
}

export function requireFile(path) {
  assert.equal(existsSync(path), true, `required file missing: ${path}`);
}
