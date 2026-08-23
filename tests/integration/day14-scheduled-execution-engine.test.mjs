import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("trusted execution engine uses service-role database access", () => {
  const source = read("src/lib/scheduled-execution.server.ts");

  assert.match(source, /supabaseAdmin/);
  assert.match(source, /claim_due_scheduled_tasks/);
  assert.match(source, /recover_expired_scheduled_task_leases/);
  assert.match(source, /complete_scheduled_task_execution/);
  assert.match(source, /fail_scheduled_task_execution/);
});

test("scheduled execution uses the existing AI provider", () => {
  const source = read("src/lib/scheduled-execution.server.ts");

  assert.match(source, /chatCompletions/);
  assert.match(source, /chatModel\("balanced"\)/);
  assert.match(source, /AiProviderError/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
  assert.doesNotMatch(source, /AZURE_OPENAI_API_KEY/);
});

test("execution produces durable run and notification evidence", () => {
  const source = read("src/lib/scheduled-execution.server.ts");

  assert.match(source, /scheduled_task_runs/);
  assert.match(source, /app_notifications/);
  assert.match(source, /notification_deliveries/);
  assert.match(source, /task_result/);
  assert.match(source, /task_failure/);
});

test("failure handling is classified and bounded by database settlement", () => {
  const source = read("src/lib/scheduled-execution.server.ts");
  const migration = read("supabase/migrations/20260822143000_day14_scheduled_execution.sql");

  assert.match(source, /classifyFailure/);
  assert.match(source, /retryable/);
  assert.match(migration, /execution_attempts < 4/);
  assert.match(migration, /interval '1 minute'/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /interval '15 minutes'/);
});

test("scheduled-task UI remains fail closed until worker ingress is deployed", () => {
  const source = read("src/lib/scheduled-tasks.functions.ts");

  assert.match(source, /scheduledExecutionAvailable = false/);
});
