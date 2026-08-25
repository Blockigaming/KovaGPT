import { readFileSync } from "node:fs";

export function verifyAiProviderContract({ provider, catalog, staging, production }) {
  const failures = [];
  const requiredProviderPatterns = [
    /ProviderKind = "azure_openai" \| "openai"/u,
    /https:\/\/api\.openai\.com\/v1/u,
    /\.openai\.azure\.com/u,
    /\.services\.ai\.azure\.com/u,
    /\/openai\/v1/u,
    /IDENTITY_ENDPOINT/u,
    /IDENTITY_HEADER/u,
    /const AZURE_OPENAI_RESOURCE = "https:\/\/cognitiveservices\.azure\.com"/u,
    /searchParams\.set\("resource", AZURE_OPENAI_RESOURCE\)/u,
    /searchParams\.set\("api-version", "2019-08-01"\)/u,
    /redirect: "error"/u,
    /"\/responses"/u,
    /responsesStreamToChatStream/u,
    /AZURE_OPENAI_DEPLOYMENT_DEEP/u,
  ];
  for (const pattern of requiredProviderPatterns) {
    if (!pattern.test(provider)) failures.push(`provider:${pattern}`);
  }
  if (/lovable\.(?:app|dev)|LOVABLE_API_KEY|@lovable\.dev/iu.test(provider)) {
    failures.push("provider:Lovable runtime present");
  }
  if (!/fallback: "gpt-5\.6-sol"/u.test(catalog)) {
    failures.push("catalog:deep fallback is not GPT-5.6 Sol");
  }
  if (
    !/id: "gpt-5\.6-sol"[\s\S]*reasoning: true[\s\S]*vision: true[\s\S]*tools: true/u.test(catalog)
  ) {
    failures.push("catalog:GPT-5.6 Sol capability contract incomplete");
  }

  for (const [environment, template] of [
    ["staging", staging],
    ["production", production],
  ]) {
    if (
      !/Cognitive Services OpenAI User/iu.test(template) &&
      !/5e0bd9bd-7b93-4f28-af87-19fc36ad61bd/u.test(template)
    ) {
      failures.push(`${environment}:Azure OpenAI user RBAC missing`);
    }
    if (
      !/name: 'AZURE_CLIENT_ID'/u.test(template) ||
      !/name: 'AZURE_OPENAI_USE_MANAGED_IDENTITY'[\s\S]*value: 'true'/u.test(template) ||
      !/AZURE_OPENAI_DEPLOYMENT_DEEP/u.test(template)
    ) {
      failures.push(`${environment}:managed identity or deep deployment mapping missing`);
    }
    if (!/name: 'KOVA_DEEP_MODEL'[\s\S]*value: 'gpt-5\.6-sol'/u.test(template)) {
      failures.push(`${environment}:GPT-5.6 Sol logical model mapping missing`);
    }
  }

  if (/AZURE_OPENAI_API_KEY|OPENAI_API_KEY/u.test(production)) {
    failures.push("production:AI API-key path must not be provisioned");
  }
  if (!/generationEnabled/u.test(production) || !/KOVA_GENERATION_DISABLED/u.test(production)) {
    failures.push("production:generation cutover must fail closed");
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = verifyAiProviderContract({
    provider: readFileSync("src/lib/ai/provider.server.ts", "utf8"),
    catalog: readFileSync("src/lib/ai/model-catalog.server.ts", "utf8"),
    staging: readFileSync("infra/azure/staging/main.bicep", "utf8"),
    production: readFileSync("infra/azure/production/main.bicep", "utf8"),
  });
  if (failures.length) {
    console.error(`AI provider contract failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(
    "AI_PROVIDER_CONTRACT=PASS primaryDeepModel=gpt-5.6-sol azureManagedIdentity=true productionApiKey=false liveSmokeRequired=true",
  );
}
