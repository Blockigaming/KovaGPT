import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260901010000_work_execution_v2.sql",
  "utf8",
);
const workRoute = readFileSync("src/routes/work.tsx", "utf8");
const agentRoute = readFileSync("src/routes/api/agents/runs.ts", "utf8");
const agentRuntime = readFileSync("src/agents/execution.server.ts", "utf8");

function section(start, end) {
  const from = migration.indexOf(start);
  const to = end ? migration.indexOf(end, from + start.length) : migration.length;
  assert.notEqual(from, -1, `missing section ${start}`);
  assert.notEqual(to, -1, `missing section boundary ${end}`);
  return migration.slice(from, to);
}

test("Work v2 extends the canonical agent_jobs queue without deleting historical schemas", () => {
  assert.match(migration, /alter table public\.agent_jobs/u);
  assert.match(migration, /add column if not exists state_version bigint/u);
  assert.match(migration, /add column if not exists lease_token uuid/u);
  assert.match(migration, /add column if not exists current_attempt_id uuid/u);
  assert.match(migration, /add column if not exists idempotency_key text/u);
  assert.match(migration, /add column if not exists tool_policy jsonb/u);
  assert.match(migration, /add column if not exists token_budget integer/u);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.agent_jobs/iu);
  assert.doesNotMatch(migration, /alter table public\.agent_runs rename|drop table public\.agent_runs/iu);
});

test("runtime activation is service-only, exact-SHA pinned, and disabled after migration", () => {
  const controls = section(
    "create table if not exists public.work_runtime_controls_v2",
    "create table if not exists public.agent_job_attempts_v2",
  );
  const activation = section(
    "create or replace function public.set_work_runtime_v2",
    "create or replace function public.owner_create_work_job_v2",
  );
  assert.match(controls, /enabled boolean not null default false/u);
  assert.match(controls, /active_source_sha text/u);
  assert.match(activation, /auth\.role\(\) <> 'service_role'/u);
  assert.match(activation, /p_source_sha !~ '\^\[a-f0-9\]\{40\}\$'/u);
  assert.match(migration, /grant execute on function public\.set_work_runtime_v2[\s\S]*?to service_role/u);
  assert.match(
    migration,
    /update public\.work_runtime_controls_v2[\s\S]*?set enabled = false,[\s\S]*?active_source_sha = null/u,
  );
});

test("owner creation is paid, idempotent, project-scoped, bounded, and concurrency-limited", () => {
  const create = section(
    "create or replace function public.owner_create_work_job_v2",
    "create or replace function public.owner_control_work_job_v2",
  );
  assert.match(create, /auth\.uid\(\)/u);
  assert.match(create, /work_runtime_enabled_v2\(\)/u);
  assert.match(create, /work_plan_tier_v2\(v_user_id\)/u);
  assert.match(create, /work_max_concurrency_v2\(v_tier\)/u);
  assert.match(create, /work_paid_plan_required/u);
  assert.match(create, /work_concurrency_limit_reached/u);
  assert.match(create, /project_members/u);
  assert.match(create, /member\.role in \('owner', 'editor'\)/u);
  assert.match(create, /idempotency_key = p_idempotency_key/u);
  assert.match(create, /unique_violation/u);
  assert.match(create, /length\(p_objective\) > 12000/u);
  assert.match(create, /p_token_budget not between 1000 and 200000/u);
  assert.match(create, /cardinality\(coalesce\(p_allowed_domains/u);
  assert.match(create, /tool_policy/u);
});

test("claims use skip-locked queue selection, entitlement checks, opaque leases, and exact source identity", () => {
  const claim = section(
    "create or replace function public.claim_work_job_v2",
    "create or replace function public.heartbeat_work_job_v2",
  );
  assert.match(claim, /auth\.role\(\) <> 'service_role'/u);
  assert.match(claim, /work_runtime_enabled_v2\(p_source_sha\)/u);
  assert.match(claim, /for update skip locked/u);
  assert.match(claim, /work_plan_tier_v2\(job\.owner_id\) in \('plus', 'pro'\)/u);
  assert.match(claim, /work_max_concurrency_v2/u);
  assert.match(claim, /agent_job_attempts_v2/u);
  assert.match(claim, /lease_token/u);
  assert.match(claim, /worker_revision/u);
  assert.match(claim, /source_sha/u);
  assert.match(claim, /current_attempt_id = v_attempt\.id/u);
});

test("heartbeat, checkpoint, and event writes are fenced by attempt, lease, and state version", () => {
  const heartbeat = section(
    "create or replace function public.heartbeat_work_job_v2",
    "create or replace function public.checkpoint_work_job_v2",
  );
  const checkpoint = section(
    "create or replace function public.checkpoint_work_job_v2",
    "create or replace function public.append_work_event_v2",
  );
  const event = section(
    "create or replace function public.append_work_event_v2",
    "create or replace function public.request_work_approval_v2",
  );
  for (const source of [heartbeat, checkpoint, event]) {
    assert.match(source, /p_attempt_id/u);
    assert.match(source, /p_lease_token/u);
    assert.match(source, /p_state_version/u);
    assert.match(source, /lease_expires_at/u);
  }
  assert.match(heartbeat, /requested_action/u);
  assert.match(checkpoint, /p_sequence <> v_job\.last_checkpoint_sequence \+ 1/u);
  assert.match(checkpoint, /integrity_hash/u);
  assert.match(event, /work_event_type_invalid/u);
  assert.match(event, /pg_column_size\(p_safe_payload\) > 32768/u);
});

test("tool calls are deny-by-default and require bounded owner approval", () => {
  const request = section(
    "create or replace function public.request_work_approval_v2",
    "create or replace function public.owner_decide_work_approval_v2",
  );
  const decide = section(
    "create or replace function public.owner_decide_work_approval_v2",
    "create or replace function public.settle_work_success_v2",
  );
  assert.match(request, /jsonb_array_elements_text[\s\S]*?allowed_tools/u);
  assert.match(request, /work_tool_not_allowed/u);
  assert.match(request, /p_risk not in \('low', 'medium', 'high'\)/u);
  assert.match(request, /idempotency_key/u);
  assert.match(request, /agent_approvals/u);
  assert.match(request, /status = 'approval_required'/u);
  assert.match(decide, /p_decision not in \('approved', 'denied'\)/u);
  assert.match(decide, /work_runtime_enabled_v2\(\)/u);
  assert.match(decide, /state_version = state_version \+ 1/u);
  assert.match(decide, /status = 'queued'/u);
  assert.match(decide, /status = 'cancelled'/u);
});

test("success and failure settlements are fenced, bounded, idempotent, and auditable", () => {
  const success = section(
    "create or replace function public.settle_work_success_v2",
    "create or replace function public.settle_work_failure_v2",
  );
  const failure = section(
    "create or replace function public.settle_work_failure_v2",
    "create or replace function public.settle_work_owner_action_v2",
  );
  assert.match(success, /v_attempt\.status = 'succeeded'/u);
  assert.match(success, /v_job\.state_version <> p_state_version/u);
  assert.match(success, /pg_column_size\(p_result\) > 524288/u);
  assert.match(success, /provider_request_id/u);
  assert.match(success, /provider_receipt/u);
  assert.match(success, /tokens_used = least\(200000/u);
  assert.match(success, /'run_completed'/u);
  assert.match(failure, /p_failure_type not in/u);
  assert.match(failure, /p_retryable and v_attempt\.attempt_number < v_job\.max_attempts/u);
  assert.match(failure, /power\(2/u);
  assert.match(failure, /'retry_scheduled'/u);
  assert.match(failure, /'run_failed'/u);
});

test("expired attempts and owner actions settle explicitly instead of silently resetting", () => {
  const owner = section(
    "create or replace function public.settle_work_owner_action_v2",
    "create or replace function public.recover_expired_work_attempts_v2",
  );
  const recover = section(
    "create or replace function public.recover_expired_work_attempts_v2",
    "create or replace function public.record_work_worker_heartbeat_v2",
  );
  assert.match(owner, /requested_action not in \('pause', 'cancel'\)/u);
  assert.match(owner, /status = case when v_action = 'pause' then 'paused' else 'cancelled' end/u);
  assert.match(recover, /attempt\.status = 'running'/u);
  assert.match(recover, /attempt\.lease_expires_at <= now\(\)/u);
  assert.match(recover, /status = 'expired'/u);
  assert.match(recover, /'lease_expired'/u);
  assert.match(recover, /requested_action in \('pause', 'cancel'\)/u);
});

test("readiness binds health to heartbeat freshness, exact SHA, runtime activation, and zero expired attempts", () => {
  const readiness = section(
    "create or replace function public.work_worker_readiness_v2",
    "revoke all on table public.work_runtime_controls_v2",
  );
  assert.match(readiness, /v_heartbeat\.status = 'healthy'/u);
  assert.match(readiness, /v_heartbeat\.source_sha = p_expected_source_sha/u);
  assert.match(readiness, /last_seen_at >= now\(\) - make_interval/u);
  assert.match(readiness, /work_runtime_enabled_v2\(p_expected_source_sha\)/u);
  assert.match(readiness, /attempt\.lease_expires_at <= now\(\)/u);
  assert.match(readiness, /due_jobs integer/u);
  assert.match(readiness, /expired_attempts integer/u);
});

test("authenticated clients receive owner reads and RPCs but no direct execution-table writes", () => {
  assert.match(migration, /revoke all on table public\.agent_job_attempts_v2 from anon, authenticated/u);
  assert.match(migration, /grant select on public\.agent_job_attempts_v2 to authenticated/u);
  assert.match(migration, /grant select on public\.agent_job_checkpoints_v2 to authenticated/u);
  assert.match(migration, /grant select on public\.agent_job_tool_calls_v2 to authenticated/u);
  assert.match(migration, /grant select on public\.agent_job_evidence_v2 to authenticated/u);
  assert.match(migration, /grant execute on function public\.owner_create_work_job_v2[\s\S]*?to authenticated/u);
  assert.match(migration, /grant execute on function public\.owner_control_work_job_v2[\s\S]*?to authenticated/u);
  assert.match(migration, /grant execute on function public\.owner_decide_work_approval_v2[\s\S]*?to authenticated/u);
  assert.match(migration, /claim_work_job_v2[\s\S]*?to service_role/u);
});

test("shipping the protocol does not prematurely expose Work or the incompatible agent ingress", () => {
  assert.match(workRoute, /Agent execution is unavailable/u);
  assert.match(workRoute, /Historical records remain readable/u);
  assert.match(agentRoute, /browser_agent_unavailable/u);
  assert.match(agentRoute, /status: 503/u);
  assert.match(agentRuntime, /executeBrowserAgent\(\): Promise<never>/u);
  assert.match(agentRuntime, /throw new Error\("browser_agent_unavailable"\)/u);
});
