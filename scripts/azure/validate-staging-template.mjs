import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const templatePath = "infra/azure/staging/main.bicep";
const parametersPath = "infra/azure/staging/main.parameters.example.json";

function requireMatch(source, pattern, description) {
  assert.match(source, pattern, description);
}

function rejectMatch(source, pattern, description) {
  assert.doesNotMatch(source, pattern, description);
}

export function validateAzureStagingTemplate({
  template = readFileSync(templatePath, "utf8"),
  parameters = readFileSync(parametersPath, "utf8"),
} = {}) {
  const parsedParameters = JSON.parse(parameters);
  const values = parsedParameters.parameters ?? {};

  requireMatch(
    template,
    /resource webApp 'Microsoft\.App\/containerApps@2025-01-01'/u,
    "web app must use the reviewed stable Container Apps API",
  );
  requireMatch(
    template,
    /resource environment 'Microsoft\.App\/managedEnvironments@2025-01-01'/u,
    "managed environment must use the reviewed stable API",
  );
  requireMatch(
    template,
    /resource budget 'Microsoft\.Consumption\/budgets@2024-08-01' = if \(deployBudget\)/u,
    "budget must be optional and use the reviewed API",
  );

  requireMatch(template, /param generationEnabled bool = false/u, "generation must default off");
  requireMatch(template, /param minReplicas int = 0/u, "staging must scale to zero by default");
  requireMatch(template, /param maxReplicas int = 2/u, "staging scale-out must be bounded");
  requireMatch(template, /allowInsecure: false/u, "public ingress must be HTTPS-only");
  requireMatch(template, /activeRevisionsMode: 'Single'/u, "staging must use single revision mode");
  requireMatch(template, /targetPort: 3000/u, "web target port must match the container");
  requireMatch(template, /path: '\/api\/health'/u, "health probes must use the health route");

  requireMatch(
    template,
    /@secure\(\)\s*param openAiSecretUri string/su,
    "OpenAI URI must be secure input",
  );
  requireMatch(
    template,
    /@secure\(\)\s*param supabaseServiceRoleSecretUri string/su,
    "Supabase service-role URI must be secure input",
  );
  requireMatch(
    template,
    /keyVaultUrl: openAiSecretUri/u,
    "OpenAI key must use Key Vault reference",
  );
  requireMatch(
    template,
    /keyVaultUrl: supabaseServiceRoleSecretUri/u,
    "Supabase service role must use Key Vault reference",
  );
  requireMatch(template, /secretRef: 'openai-api-key'/u, "OpenAI env must reference app secret");
  requireMatch(
    template,
    /secretRef: 'supabase-service-role-key'/u,
    "service-role env must reference app secret",
  );
  requireMatch(
    template,
    /7f951dda-4ed3-4680-a7ca-43fe172d538d/u,
    "managed identity must receive AcrPull",
  );
  requireMatch(
    template,
    /4633458b-17de-408a-b874-0445c86b69e6/u,
    "managed identity must receive Key Vault Secrets User",
  );

  for (const model of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
    requireMatch(template, new RegExp(model.replaceAll(".", "\\."), "u"), `${model} missing`);
  }
  requireMatch(template, /KOVA_GENERATION_DISABLED/u, "effective generation kill switch missing");
  requireMatch(template, /workspaceCapping/u, "Log Analytics daily cap missing");
  requireMatch(template, /logRetentionDays/u, "Log Analytics retention control missing");

  requireMatch(
    template,
    /image reference built and verified with the synthetic staging browser Supabase configuration/iu,
    "image provenance must require verified browser public configuration",
  );
  requireMatch(
    template,
    /name: 'SUPABASE_URL'\s+value: supabaseUrl/su,
    "server runtime must receive the synthetic Supabase URL",
  );
  requireMatch(
    template,
    /name: 'SUPABASE_PUBLISHABLE_KEY'\s+value: supabasePublishableKey/su,
    "server runtime must receive the synthetic publishable key",
  );
  rejectMatch(
    template,
    /name: 'VITE_SUPABASE_(?:URL|PUBLISHABLE_KEY)'/u,
    "runtime Vite variables cannot prove browser bundle configuration",
  );

  rejectMatch(
    template,
    /@lovable\.dev|LOVABLE_|lovable\.(?:app|dev)/iu,
    "Lovable dependency prohibited",
  );
  rejectMatch(template, /ca-kovagpt-dev/u, "production app name prohibited in staging template");
  rejectMatch(template, /mfbycmbjygcfkrsuepxf/u, "real Supabase project prohibited");
  rejectMatch(
    template,
    /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/iu,
    "TLS bypass prohibited",
  );
  rejectMatch(
    template,
    /OPENAI_API_KEY'\s*\n\s*value:/u,
    "OpenAI key cannot be a literal env value",
  );
  rejectMatch(
    template,
    /SUPABASE_SERVICE_ROLE_KEY'\s*\n\s*value:/u,
    "service-role key cannot be a literal env value",
  );

  assert.equal(values.generationEnabled?.value, false, "example generation must remain disabled");
  assert.equal(values.minReplicas?.value, 0, "example must scale to zero");
  assert.equal(values.maxReplicas?.value, 2, "example max replicas must remain bounded");
  assert.equal(values.deployBudget?.value, false, "example budget requires explicit enablement");
  assert.match(
    values.imageReference?.value ?? "",
    /@sha256:/u,
    "example image must be digest-pinned",
  );

  rejectMatch(
    parameters,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/u,
    "real OpenAI key prohibited",
  );
  rejectMatch(parameters, /\bsb_secret_[A-Za-z0-9_-]{20,}/u, "real Supabase secret prohibited");
  rejectMatch(parameters, /mfbycmbjygcfkrsuepxf/u, "real Supabase project prohibited");
  rejectMatch(parameters, /lovable\.(?:app|dev)|LOVABLE_/iu, "Lovable configuration prohibited");

  return {
    browserConfigIsBuildVerified: true,
    containerAppApi: "2025-01-01",
    generationEnabled: false,
    maxReplicas: values.maxReplicas.value,
    scaleToZero: values.minReplicas.value === 0,
    imageUsesDigest: true,
    zeroLovable: true,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evidence = validateAzureStagingTemplate();
  console.log(`AZURE_STAGING_TEMPLATE_VALIDATION=${JSON.stringify(evidence)}`);
}
