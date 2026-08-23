import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "supabase/migrations/20260823113000_day14_atomic_settlement.sql",
  "utf8",
);

test("recurrence helper is not incorrectly immutable", () => {
  assert.match(
    source,
    /alter function public\.next_scheduled_task_occurrence\(timestamptz, text\)\s+stable/,
  );
});

test("success settlement updates task, run, and delivery state", () => {
  assert.match(source, /settle_scheduled_task_success/);
  assert.match(source, /update public\.scheduled_tasks/);
  assert.match(source, /update public\.scheduled_task_runs/);
  assert.match(source, /app_notifications/);
  assert.match(source, /notification_deliveries/);
});

test("notification errors cannot reverse a completed task", () => {
  assert.match(source, /exception\s+when others then\s+v_delivery := 'failed'/);
  assert.match(source, /Task completed, but notification delivery failed/);
});

test("failure settlement preserves bounded retry state", () => {
  assert.match(source, /settle_scheduled_task_failure/);
  assert.match(source, /execution_attempts < 4/);
  assert.match(source, /interval '1 minute'/);
  assert.match(source, /interval '5 minutes'/);
  assert.match(source, /interval '15 minutes'/);
});

test("settlement remains service-role only", () => {
  assert.match(source, /auth\.role\(\) <> 'service_role'/);
  assert.match(source, /from public, anon, authenticated/);
  assert.match(source, /to service_role/);
});
