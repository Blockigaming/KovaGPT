import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const config = readFileSync("vite.work-worker.config.ts", "utf8");
const entry = readFileSync("src/workers/work-v2.ts", "utf8");
const runner = readFileSync("src/workers/work-v2-runner.ts", "utf8");
const engine = readFileSync("src/lib/work-execution-v2.server.ts", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const workRoute = readFileSync("src/routes/work.tsx", "utf8");

test("the normal production build includes scheduled and Work one-shot bundles", () => {
  assert.equal(packageJson.scripts.build, "vite build && npm run build:workers");
  assert.equal(
    packageJson.scripts["build:workers"],
    "npm run build:scheduled-worker && npm run build:work-worker",
  );
  assert.equal(
    packageJson.scripts["build:work-worker"],
    "vite build --config vite.work-worker.config.ts",
  );
  assert.equal(packageJson.scripts["worker:work:v2"], "node dist/worker/work-v2.mjs");
  assert.match(config, /src\/workers\/work-v2\.ts/u);
  assert.match(config, /dist\/worker/u);
  assert.match(config, /emptyOutDir: false/u);
  assert.match(config, /entryFileNames: "work-v2\.mjs"/u);
  assert.match(config, /noExternal: true/u);
  assert.match(dockerfile, /COPY --from=build --chown=kova:kova \/app\/dist \.\/dist/u);
});

test("the Work worker is a dedicated non-http one-shot process", () => {
  assert.match(entry, /await runWorkWorkerOnce/u);
  assert.match(entry, /runWorkExecutionBatchV2/u);
  assert.match(entry, /record_work_worker_heartbeat_v2/u);
  assert.match(entry, /work_worker_readiness_v2/u);
  assert.match(entry, /process\.exitCode = 1/u);
  assert.doesNotMatch(entry, /createServer|listen\(|api\/internal/iu);
  assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(true\)/u);
});

test("Work execution requires an explicit enable flag and exact runtime identity", () => {
  assert.match(runner, /KOVA_WORK_WORKER_ENABLED !== "1"/u);
  assert.match(runner, /work_worker_disabled/u);
  assert.match(runner, /KOVA_WORK_WORKER_ENVIRONMENT/u);
  assert.match(runner, /KOVA_SOURCE_SHA/u);
  assert.match(runner, /KOVA_WORKER_REVISION/u);
  assert.match(runner, /KOVA_WORK_WORKER_CAPACITY/u);
  assert.match(runner, /KOVA_WORK_WORKER_BATCH_LIMIT/u);
  assert.match(runner, /readiness\.sourceSha !== sourceSha/u);
  assert.match(runner, /readiness\.workerRevision !== revision/u);
});

test("the model boundary is Azure managed identity only with no direct-key fallback", () => {
  assert.match(engine, /KOVA_WORK_MODEL_PROVIDER !== "azure-managed-identity"/u);
  assert.match(engine, /KOVA_RUNTIME_PLATFORM !== "azure-container-apps"/u);
  assert.match(engine, /IDENTITY_ENDPOINT/u);
  assert.match(engine, /IDENTITY_HEADER/u);
  assert.match(engine, /KOVA_WORK_MODEL_DEPLOYMENT/u);
  assert.match(engine, /AZURE_OPENAI_DEPLOYMENT_DEEP/u);
  assert.match(engine, /environment\.OPENAI_API_KEY \|\| environment\.AZURE_OPENAI_API_KEY/u);
  assert.match(engine, /work_direct_api_key_forbidden/u);
  assert.match(engine, /chatModel\("deep"\)/u);
});

test("the first Work slice is truthful model-only execution and denies unavailable tools", () => {
  assert.match(engine, /runtime: "model_only_v2"/u);
  assert.match(engine, /tools that are not yet available in the isolated Work worker/u);
  assert.doesNotMatch(engine, /browser\.newPage|page\.goto|child_process|execFile|spawn\(/u);
  assert.match(workRoute, /Agent execution is unavailable/u);
  assert.match(workRoute, /Historical records remain readable/u);
});

test("logs and failure heartbeats expose bounded metadata rather than raw private errors", () => {
  assert.match(runner, /safeFailure\(reason/u);
  assert.match(runner, /errorName: reason instanceof Error \? reason\.name/u);
  assert.doesNotMatch(runner, /reason\.message/u);
  assert.match(runner, /status: "running"/u);
  assert.match(runner, /status: "healthy"/u);
  assert.match(runner, /status: "failed"/u);
});
