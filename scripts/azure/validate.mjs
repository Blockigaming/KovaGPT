import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const requiredFiles = [
  "Dockerfile",
  ".dockerignore",
  "package-lock.json",
  "src/routes/api/health.ts",
];
const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length) throw new Error(`Missing Azure readiness files: ${missing.join(", ")}`);

const dockerfile = readFileSync("Dockerfile", "utf8");
for (const pattern of [/FROM node:24-bookworm-slim/u, /npm ci/u, /USER kova/u]) {
  if (!pattern.test(dockerfile)) throw new Error(`Dockerfile failed validation: ${pattern}`);
}

const startup = dockerfile.match(/^CMD (\[.*\])$/mu);
assert.ok(startup, "Dockerfile must define the guarded Node startup command");
assert.deepEqual(JSON.parse(startup[1]), [
  "sh",
  "-c",
  'if [ "$KOVA_AUTH_MODE" != "$KOVA_COMPILED_AUTH_MODE" ]; then echo \'Browser and server authentication modes must match\' >&2; exit 1; fi; exec node dist/server/index.mjs',
]);

const envExample = readFileSync(".env.example", "utf8");
for (const name of [
  "AZURE_ENVIRONMENT",
  "AZURE_FOUNDRY_ENDPOINT",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_DEPLOYMENT_CHAT",
  "AZURE_OPENAI_DEPLOYMENT_THINKING",
  "AZURE_OPENAI_DEPLOYMENT_DEEP",
  "AZURE_OPENAI_DEPLOYMENT_IMAGE",
  "AZURE_OPENAI_DEPLOYMENT_EMBEDDING",
  "AZURE_CLIENT_ID",
  "PORT",
  "HOST",
  "OPENAI_API_KEY",
]) {
  if (!new RegExp(`^${name}=`, "mu").test(envExample))
    throw new Error(`.env.example missing ${name}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["container:build", "container:run", "container:smoke", "azure:validate"]) {
  if (!packageJson.scripts?.[script]) throw new Error(`package.json missing ${script}`);
}

console.log("Azure Container Apps readiness validation passed.");
