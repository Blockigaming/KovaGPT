import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "Dockerfile",
  ".dockerignore",
  "package-lock.json",
  "src/routes/api/health.ts",
  "infra/azure/production/main.bicep",
  "infra/azure/staging/main.bicep",
  "scripts/azure/deploy-production-local.sh",
  "scripts/azure/deploy-staging-local.sh",
  "scripts/azure/rollback-production-local.sh",
  "scripts/azure/verify-rbac-local.sh",
  "scripts/azure/verify-scheduled-job-local.sh",
  "scripts/azure/verify-observability-local.sh",
  "scripts/azure/validate-production-template.mjs",
  "scripts/azure/validate-staging-template.mjs",
];
const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length) throw new Error(`Missing Azure readiness files: ${missing.join(", ")}`);

if (existsSync("wrangler.jsonc") || existsSync(".wrangler")) {
  throw new Error("Cloudflare Worker deployment artifacts must not be part of the Azure runtime");
}

const dockerfile = readFileSync("Dockerfile", "utf8");
for (const pattern of [
  /FROM node:24-bookworm-slim/u,
  /npm ci/u,
  /KOVA_NITRO_PRESET=node-server/u,
  /USER kova/u,
  /CMD \["node", "dist\/server\/index\.mjs"\]/u,
]) {
  if (!pattern.test(dockerfile)) throw new Error(`Dockerfile failed validation: ${pattern}`);
}

const vite = readFileSync("vite.config.ts", "utf8");
if (!/preset:\s*"node-server"/u.test(vite)) {
  throw new Error("vite.config.ts must emit the Azure Node server runtime");
}
if (/cloudflare-module|@cloudflare\/vite-plugin/iu.test(vite)) {
  throw new Error("vite.config.ts still contains an active Cloudflare Worker runtime path");
}

const production = readFileSync("infra/azure/production/main.bicep", "utf8");
for (const pattern of [
  /Microsoft\.App\/containerApps@/u,
  /Microsoft\.App\/jobs@/u,
  /Microsoft\.ManagedIdentity\/userAssignedIdentities@/u,
  /Microsoft\.KeyVault\/vaults@/u,
  /Cognitive Services OpenAI User/iu,
  /4633458b-17de-408a-b874-0445c86b69e6/iu,
  /AcrPull/iu,
  /AZURE_OPENAI_USE_MANAGED_IDENTITY/u,
  /KOVA_DEEP_MODEL[\s\S]*gpt-5\.6-sol/u,
  /cloudflareOriginCidrs/u,
  /ipSecurityRestrictions/u,
  /sourceSha/u,
  /sourceTree/u,
  /KOVA_PUBLIC_URL/u,
  /@sha256:/u,
]) {
  if (!pattern.test(production)) {
    throw new Error(`Production Azure template failed validation: ${pattern}`);
  }
}
if (/AZURE_OPENAI_API_KEY|OPENAI_API_KEY/u.test(production)) {
  throw new Error("Production Azure template must use managed identity rather than AI API keys");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of [
  "container:build",
  "container:run",
  "container:smoke",
  "azure:validate",
  "azure:production:validate",
  "azure:staging:validate",
  "azure:staging:deploy",
  "azure:production:deploy",
  "azure:production:rollback",
  "azure:production:rbac:verify",
  "azure:production:scheduler:verify",
  "azure:production:observability:verify",
  "release:production:verify",
  "release:architecture",
]) {
  if (!packageJson.scripts?.[script]) throw new Error(`package.json missing ${script}`);
}

console.log(
  "AZURE_RUNTIME_VALIDATION=PASS runtime=node-server hosting=container-apps managedIdentity=true immutableImage=true",
);
