import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260831180000_scheduled_delivery_observability_v2.sql",
  "utf8",
);
const worker = readFileSync("src/workers/scheduled-v2-runner.ts", "utf8");
const entry = readFileSync("src/workers/scheduled-v2.ts", "utf8");
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

function section(start, end) {
  const from = migration.indexOf(start);
  const to = end ? migration.indexOf(end, from + start.length) : migration.length;
  assert.notEqual(from, -1, `missing section ${start}`);
  assert.notEqual(to, -1, `missing section boundary ${end}`);
  return migration.slice(from, to);
}

test("in-app outbox delivery is service-role-only and idempotent", () => {
  const delivery = section(
    "create or replace function public.deliver_scheduled_in_app_outbox_v2",
    "create or replace function public.recover_stale_scheduled_delivery_v2",
  );
  assert.match(delivery, /auth\.role\(\) <> 'service_role'/u);
  assert.match(delivery, /channel = 'in_app'/u);
  assert.match(delivery, /status in \('pending', 'failed'\)/u);
  assert.match(delivery, /for update skip locked/u);
  assert.match(delivery, /insert into public\.app_notifications/u);
  assert.match(delivery, /v_row\.id/u);
  assert.match(delivery, /on conflict \(id\) do update/u);
  assert.match(delivery, /'\/scheduled-tasks'/u);
  assert.match(delivery, /status = 'sent'/u);
  assert.doesNotMatch(delivery, /http|fetch|resend|email_api/iu);
});

test("delivery failures use bounded retry state without persisting raw database errors", () => {
  const delivery = section(
    "create or replace function public.deliver_scheduled_in_app_outbox_v2",
    "create or replace function public.recover_stale_scheduled_delivery_v2",
  );
  assert.match(delivery, /when others then/u);
  assert.match(delivery, /v_attempt >= 8/u);
  assert.match(delivery, /status = 'disabled'/u);
  assert.match(delivery, /status = 'failed'/u);
  assert.match(delivery, /least\(3600, 30 \* \(1 << least\(v_attempt - 1, 6\)\)\)/u);
  assert.doesNotMatch(delivery, /(?:last_safe_error|safe_error)\s*=\s*SQLERRM/u);
});

test("stale processing rows have a bounded service-role recovery path", () => {
  const recovery = section(
    "create or replace function public.recover_stale_scheduled_delivery_v2",
    "create or replace function public.scheduled_worker_readiness_v2",
  );
  assert.match(recovery, /auth\.role\(\) <> 'service_role'/u);
  assert.match(recovery, /status = 'processing'/u);
  assert.match(recovery, /for update skip locked/u);
  assert.match(recovery, /attempt_count >= 8/u);
  assert.match(recovery, /'A stale delivery claim was recovered\.'/u);
});

test("readiness exposes heartbeat freshness and bounded scheduler debt metrics", () => {
  const readiness = section(
    "create or replace function public.scheduled_worker_readiness_v2",
    "revoke all on function public.deliver_scheduled_in_app_outbox_v2",
  );
  for (const metric of [
    "heartbeat_age_seconds",
    "due_tasks",
    "running_attempts",
    "expired_attempts",
    "ready_deliveries",
    "failed_deliveries",
    "disabled_deliveries",
  ]) {
    assert.match(readiness, new RegExp(metric, "u"));
  }
  for (const status of [
    "heartbeat_missing",
    "worker_failed",
    "heartbeat_stale",
    "expired_attempts",
    "delivery_backlog",
    "delivery_disabled",
    "ready",
  ]) {
    assert.match(readiness, new RegExp(`'${status}'`, "u"));
  }
  assert.match(readiness, /v_ready := v_status = 'ready'/u);
});

test("delivery and readiness RPCs are unavailable to authenticated clients", () => {
  for (const signature of [
    "deliver_scheduled_in_app_outbox_v2(integer)",
    "recover_stale_scheduled_delivery_v2(integer, integer)",
    "scheduled_worker_readiness_v2(text, integer, integer)",
  ]) {
    const escaped = signature.replace(/[()]/gu, "\\$&");
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*?authenticated`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*?service_role`, "u"),
    );
  }
});

test("one-shot worker drains delivery before claiming healthy readiness", () => {
  const runStart = worker.indexOf("export async function runScheduledWorkerOnce");
  assert.notEqual(runStart, -1);

  const run = worker.slice(runStart);
  const deliveryIndex = run.indexOf("await dependencies.runDeliveryBatch");
  const healthyIndex = run.indexOf('status: "healthy"');
  const readinessIndex = run.indexOf("await dependencies.readReadiness");

  assert.notEqual(deliveryIndex, -1);
  assert.notEqual(healthyIndex, -1);
  assert.notEqual(readinessIndex, -1);

  assert.ok(deliveryIndex < healthyIndex);
  assert.ok(healthyIndex < readinessIndex);

  assert.match(run, /readiness\.sourceSha !== sourceSha/u);
  assert.match(run, /readiness\.workerRevision !== revision/u);
  assert.match(run, /scheduled_worker_readiness_unhealthy/u);
});

test("the executable worker wires real delivery/readiness adapters while product stays disabled", () => {
  assert.match(entry, /runScheduledDeliveryBatchV2/u);
  assert.match(entry, /readScheduledWorkerReadinessV2/u);
  assert.match(entry, /runDeliveryBatch: runScheduledDeliveryBatchV2/u);
  assert.match(entry, /readReadiness: readScheduledWorkerReadinessV2/u);
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
});
