import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const config = readFileSync("vite.scheduled-worker.config.ts", "utf8");
const entry = readFileSync("src/workers/scheduled-v2.ts", "utf8");
const runner = readFileSync("src/workers/scheduled-v2-runner.ts", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

test("the normal production build includes one bundled scheduled worker", () => {
  assert.equal(
    packageJson.scripts.build,
    "vite build && npm run build:scheduled-worker",
  );
  assert.equal(
    packageJson.scripts["build:scheduled-worker"],
    "vite build --config vite.scheduled-worker.config.ts",
  );
  assert.equal(packageJson.scripts["worker:scheduled:v2"], "node dist/worker/scheduled-v2.mjs");
  assert.match(config, /src\/workers\/scheduled-v2\.ts/u);
  assert.match(config, /dist\/worker/u);
  assert.match(config, /entryFileNames: "scheduled-v2\.mjs"/u);
  assert.match(config, /noExternal: true/u);
  assert.match(dockerfile, /COPY --from=build --chown=kova:kova \/app\/dist \.\/dist/u);
});

test("the worker is a one-shot process and not another HTTP wrapper", () => {
  assert.match(entry, /await runScheduledWorkerOnce/u);
  assert.match(entry, /runScheduledExecutionBatchV2/u);
  assert.match(entry, /record_scheduled_worker_heartbeat_v2/u);
  assert.match(entry, /process\.exitCode = 1/u);
  assert.doesNotMatch(entry, /createServer|listen\(|fetch\([^)]*api\/internal/iu);
  assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(true\)/u);
});

test("the worker cannot execute without an explicit deployment enable flag", () => {
  assert.match(runner, /KOVA_SCHEDULED_WORKER_ENABLED !== "1"/u);
  assert.match(runner, /scheduled_worker_disabled/u);
  assert.match(runner, /KOVA_SCHEDULED_WORKER_ENVIRONMENT/u);
  assert.match(runner, /KOVA_SOURCE_SHA/u);
  assert.match(runner, /KOVA_SCHEDULED_WORKER_BATCH_LIMIT/u);
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
});

test("logs and failure heartbeats carry bounded metadata instead of private errors", () => {
  assert.match(runner, /safeFailure\(reason/u);
  assert.match(runner, /errorName: reason instanceof Error \? reason\.name/u);
  assert.doesNotMatch(runner, /reason\.message/u);
  assert.match(runner, /status: "running"/u);
  assert.match(runner, /status: "healthy"/u);
  assert.match(runner, /status: "failed"/u);
});
