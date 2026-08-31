import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260831100000_scheduled_execution_v2.sql",
  "utf8",
);
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

const serviceOnlyFunctions = [
  "pause_ineligible_scheduled_tasks_v2",
  "claim_due_scheduled_task_occurrence_v2",
  "heartbeat_scheduled_task_attempt_v2",
  "recover_expired_scheduled_task_attempts_v2",
  "settle_scheduled_task_success_v2",
  "settle_scheduled_task_failure_v2",
  "settle_scheduled_task_canceled_v2",
  "record_scheduled_worker_heartbeat_v2",
];

test("v2 persists immutable occurrences, separate attempts, outbox, and heartbeat evidence", () => {
  for (const table of [
    "scheduled_task_occurrences",
    "scheduled_task_attempts",
    "scheduled_task_delivery_outbox",
    "scheduled_worker_heartbeats",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, "u"));
  }

  assert.match(migration, /unique \(task_id, scheduled_for\)/u);
  assert.match(migration, /unique \(occurrence_id, attempt_number\)/u);
  assert.match(migration, /unique \(occurrence_id, channel, event_type\)/u);
  assert.match(migration, /lease_token uuid not null default gen_random_uuid\(\)/u);
  assert.match(migration, /task_state_version bigint not null/u);
  assert.match(
    migration,
    /foreign key \(task_id, user_id\)[\s\S]*scheduled_tasks \(id, user_id\)/u,
  );
});

test("claims are service-only, owner-isolated, entitlement checked and concurrency bounded", () => {
  assert.match(migration, /auth\.role\(\) <> 'service_role'/u);
  assert.match(migration, /scheduled_task_plan_tier_v2\(st\.user_id\) in \('plus', 'pro'\)/u);
  assert.match(
    migration,
    /active_occ\.user_id = st\.user_id[\s\S]*active_occ\.status = 'running'/u,
  );
  assert.match(migration, /for update skip locked/u);
  assert.match(migration, /limit 1;/u);
  assert.match(migration, /retry_occurrence_id/u);
});

test("lease heartbeats and settlement are fenced by opaque attempt identity", () => {
  assert.match(
    migration,
    /id = p_attempt_id[\s\S]*occurrence_id = p_occurrence_id[\s\S]*task_id = p_task_id[\s\S]*lease_token = p_lease_token/u,
  );
  assert.match(migration, /v_attempt\.lease_expires_at <= now\(\)/u);
  assert.match(migration, /v_task\.state_version <> v_occ\.task_state_version/u);
  assert.match(migration, /scheduled_execution_state_changed/u);
  assert.match(migration, /scheduled_execution_cancel_requested/u);
});

test("success settlement queues an idempotent outbox record instead of delivering inline", () => {
  const success = migration.slice(
    migration.indexOf("create or replace function public.settle_scheduled_task_success_v2"),
    migration.indexOf("create or replace function public.settle_scheduled_task_failure_v2"),
  );
  assert.match(success, /scheduled_task_delivery_outbox/u);
  assert.match(success, /on conflict \(occurrence_id, channel, event_type\) do nothing/u);
  assert.doesNotMatch(success, /insert into public\.app_notifications/u);
  assert.doesNotMatch(success, /insert into public\.notification_deliveries/u);
});

test("retry protocol is bounded, deterministic and keeps one occurrence across attempts", () => {
  assert.match(
    migration,
    /attempt_number integer not null check \(attempt_number between 1 and 4\)/u,
  );
  assert.match(migration, /when 1 then 60[\s\S]*when 2 then 300[\s\S]*else 900/u);
  assert.match(
    migration,
    /hashtextextended\(p_occurrence_id::text, v_attempt\.attempt_number::bigint\)/u,
  );
  assert.match(
    migration,
    /retry_occurrence_id = case when v_retry_at is null then null else p_occurrence_id end/u,
  );
});

test("expired leases become explicit attempts and are never silently reset", () => {
  const recovery = migration.slice(
    migration.indexOf(
      "create or replace function public.recover_expired_scheduled_task_attempts_v2",
    ),
    migration.indexOf("create or replace function public.settle_scheduled_task_success_v2"),
  );
  assert.match(recovery, /status = 'expired'/u);
  assert.match(recovery, /failure_type = 'lease_expired'/u);
  assert.match(
    recovery,
    /status = case when v_retry_at is null then 'failed' else 'retry_wait' end/u,
  );
});

test("authenticated clients lose direct scheduled-task mutation and use owner RPC boundaries", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on public\.scheduled_tasks from authenticated/u,
  );
  for (const name of [
    "owner_create_scheduled_task_v2",
    "owner_update_scheduled_task_v2",
    "owner_set_scheduled_task_state_v2",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\b`, "u"));
  }
  assert.match(migration, /auth\.uid\(\)/u);
});

test("worker protocol RPCs remain service-role only", () => {
  for (const name of serviceOnlyFunctions) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${escaped}\\([\\s\\S]*?authenticated`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${escaped}\\([\\s\\S]*?to service_role`, "u"),
    );
  }
});

test("shipping the v2 schema does not enable scheduled execution", () => {
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
  assert.doesNotMatch(migration, /scheduledExecutionAvailable\s*=\s*true/u);
});
