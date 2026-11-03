import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");

test("production task activation requires protected main-branch OIDC and explicit approval", () => {
  const yml = read(".github/workflows/activate-kova-scheduled-tasks-production.yml");
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /github\.ref == 'refs\/heads\/main'/);
  assert.match(yml, /inputs\.confirmation == 'ACTIVATE'/);
  assert.match(yml, /environment:\s+name: production/);
  assert.match(yml, /id-token: write/);
  assert.match(yml, /azure\/login@/);
  assert.match(yml, /JOB_NAME: kovagpt-scheduled-execution/);
  assert.doesNotMatch(yml, /schedule:\s*$/m, "GitHub must not repeatedly deploy this job");
});

test("worker runs only on a verified direct Azure origin and cannot take over email worker", () => {
  const yml = read(".github/workflows/activate-kova-scheduled-tasks-production.yml");
  assert.match(yml, /azurecontainerapps/);
  assert.match(yml, /KOVA_SCHEDULED_TASK_ALLOWED_HOST/);
  assert.match(yml, /auth-email\|notification-dispatch/);
  assert.match(yml, /worker_missing_secret_reference/);
  assert.match(yml, /triggerType.*Schedule/);
  assert.match(yml, /cronExpression/);
  assert.match(yml, /replicaTimeout.*120/);
  assert.match(yml, /IMAGE_REFERENCE/);
  assert.match(yml, /sha256/);
  assert.doesNotMatch(yml, /\$\{\{ secrets\.SCHEDULED_TASK_SECRET \}\}/);
});

test("the production image contains the one-shot task invoker, not task prompts", () => {
  const docker = read("Dockerfile");
  assert.match(docker, /scripts\/scheduled-tasks\/production-worker\.mjs/);
  const source = read("scripts/scheduled-tasks/production-worker.mjs");
  assert.match(source, /\/api\/internal\/scheduled-execution/);
  assert.match(source, /Bearer/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.doesNotMatch(source, /supabaseAdmin|service_role|read_file|raw_app_meta_data/);
});
