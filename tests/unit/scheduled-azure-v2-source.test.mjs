import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("infra/azure/modules/scheduled-worker-job.bicep", "utf8");
const production = readFileSync("infra/azure/production/main.bicep", "utf8");
const staging = readFileSync("infra/azure/staging/main.bicep", "utf8");
const verifier = readFileSync("scripts/azure/verify-scheduled-job-local.sh", "utf8");
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

test("staging and production both wire the dedicated scheduled worker module", () => {
  for (const source of [production, staging]) {
    assert.match(
      source,
      /module scheduledWorker '\.\.\/modules\/scheduled-worker-job\.bicep' = if \(deployScheduledJob\)/u,
    );
    assert.match(source, /schedulerBatchLimit/u);
    assert.match(source, /schedulerDeliveryBatchLimit/u);
    assert.match(source, /deploySchedulerAlerts/u);
    assert.match(source, /schedulerAlertActionGroupResourceIds/u);
    assert.doesNotMatch(source, /var schedulerScript = '''|KOVA_SCHEDULED_EXECUTION_ENDPOINT/u);
  }
});

test("scheduled worker job executes the immutable non-http worker with least-privilege secrets", () => {
  assert.match(moduleSource, /resource scheduledJob 'Microsoft\.App\/jobs@2025-01-01'/u);
  assert.match(moduleSource, /args: \[\s*'dist\/worker\/scheduled-v2\.mjs'\s*\]/u);
  assert.match(moduleSource, /name: 'KOVA_SCHEDULED_WORKER_ENABLED'[\s\S]*?value: '1'/u);
  assert.match(moduleSource, /name: 'KOVA_SOURCE_SHA'[\s\S]*?value: sourceSha/u);
  assert.match(
    moduleSource,
    /name: 'SUPABASE_SERVICE_ROLE_KEY'[\s\S]*?secretRef: 'supabase-service-role-key'/u,
  );
  assert.match(
    moduleSource,
    /name: 'KOVA_IP_HASH_SECRET'[\s\S]*?secretRef: 'kova-ip-hash-secret'/u,
  );
  assert.doesNotMatch(
    moduleSource,
    /scheduled-execution-secret|SCHEDULED_TASK_SECRET|KOVA_SCHEDULED_EXECUTION_ENDPOINT/u,
  );
});

test("scheduler alerts cover terminal failures and missing successful executions", () => {
  assert.match(moduleSource, /Microsoft\.Insights\/scheduledQueryRules@2023-12-01/u);
  assert.match(moduleSource, /scheduled_worker_failed/u);
  assert.match(moduleSource, /scheduled_worker_process_failed/u);
  assert.match(moduleSource, /scheduled_worker_completed/u);
  assert.match(moduleSource, /operator: 'LessThan'[\s\S]*?threshold: 1/u);
  assert.match(moduleSource, /actionGroups: alertActionGroupResourceIds/u);
});

test("deployed-job verifier is structural by default and canary execution is explicit", () => {
  assert.match(verifier, /KOVA_SCHEDULER_RUN_CANARY:-0/u);
  assert.match(verifier, /dist\/worker\/scheduled-v2\.mjs/u);
  assert.match(verifier, /KOVA_SCHEDULED_WORKER_ENABLED/u);
  assert.match(verifier, /KOVA_EXPECTED_SOURCE_SHA/u);
  assert.doesNotMatch(verifier, /api\/internal\/scheduled-execution|definitely-invalid/u);
});

test("Azure source wiring does not make the product claim scheduler readiness", () => {
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
});
