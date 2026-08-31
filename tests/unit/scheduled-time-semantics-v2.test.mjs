import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260831140000_scheduled_time_semantics_v2.sql",
  "utf8",
);
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

function section(start, end) {
  const from = migration.indexOf(start);
  const to = end ? migration.indexOf(end, from + start.length) : migration.length;
  assert.notEqual(from, -1, `missing section ${start}`);
  assert.notEqual(to, -1, `missing section boundary ${end}`);
  return migration.slice(from, to);
}

test("IANA zones and schedule rules are validated and normalized centrally", () => {
  const normalize = section(
    "create or replace function public.normalize_scheduled_task_rule_v2",
    "create or replace function public.scheduled_resolve_local_v2",
  );
  assert.match(migration, /from pg_catalog\.pg_timezone_names/u);
  assert.match(normalize, /jsonb_object_keys\(v_input\)/u);
  for (const key of [
    "local_time",
    "iso_weekday",
    "day_of_month",
    "month_day_policy",
    "ambiguous_time_policy",
    "nonexistent_time_policy",
    "missed_run_policy",
    "lateness_grace_seconds",
  ]) {
    assert.match(normalize, new RegExp(`'${key}'`, "u"));
  }
  assert.match(normalize, /'version', 2/u);
  assert.match(normalize, /v_lateness_grace_seconds not between 0 and 3600/u);
});

test("local wall-clock resolution handles gaps and overlaps explicitly", () => {
  const resolve = section(
    "create or replace function public.scheduled_resolve_local_v2",
    "create or replace function public.scheduled_next_occurrence_v2",
  );
  assert.match(resolve, /p_local at time zone p_time_zone/u);
  assert.match(resolve, /p_nonexistent_policy = 'skip'/u);
  assert.match(resolve, /'skipped_nonexistent'/u);
  assert.match(resolve, /for v_delta in 1\.\.180 loop/u);
  assert.match(resolve, /'shifted_forward'/u);
  assert.match(resolve, /p_ambiguous_policy = 'earlier'/u);
  assert.match(resolve, /'ambiguous_earlier'/u);
  assert.match(resolve, /'ambiguous_later'/u);
});

test("daily weekly and monthly recurrence preserve local time across DST", () => {
  const next = section(
    "create or replace function public.scheduled_next_occurrence_v2",
    "create or replace function public.scheduled_coalesce_due_v2",
  );
  assert.match(next, /p_repeat = 'daily'/u);
  assert.match(next, /p_repeat = 'weekly'/u);
  assert.match(next, /p_repeat = 'monthly'/u);
  assert.match(next, /v_previous_local := p_previous at time zone p_time_zone/u);
  assert.match(next, /v_candidate_local := v_candidate_date \+ v_local_time/u);
  assert.match(next, /v_rule ->> 'month_day_policy' = 'skip'/u);
  assert.match(next, /v_day := v_days_in_month/u);
  assert.match(next, /scheduled_resolve_local_v2/u);
});

test("backlogs either coalesce to the latest due run or skip without provider spend", () => {
  const coalesce = section(
    "create or replace function public.scheduled_coalesce_due_v2",
    "create or replace function public.owner_create_scheduled_task_v2",
  );
  assert.match(coalesce, /v_policy := v_rule ->> 'missed_run_policy'/u);
  assert.match(coalesce, /v_due := v_next/u);
  assert.match(coalesce, /v_skipped := v_skipped \+ 1/u);
  assert.match(coalesce, /'missed_skipped'/u);
  assert.match(coalesce, /'coalesced_latest'/u);
  assert.match(coalesce, /p_now > p_first_due \+ make_interval\(secs => v_grace\)/u);

  const claim = section(
    "create or replace function public.claim_due_scheduled_task_occurrence_v2",
    "create or replace function public.settle_scheduled_task_success_v2",
  );
  assert.match(claim, /if not v_due\.should_execute then/u);
  assert.match(claim, /'missed'/u);
  assert.match(claim, /scheduled_task_delivery_outbox/u);
  assert.match(claim, /continue;/u);
  assert.match(claim, /v_due\.skipped_count/u);
});

test("owner RPCs persist canonical rules and fence edits during execution", () => {
  const create = section(
    "create or replace function public.owner_create_scheduled_task_v2",
    "create or replace function public.owner_update_scheduled_task_v2",
  );
  const update = section(
    "create or replace function public.owner_update_scheduled_task_v2",
    "create or replace function public.claim_due_scheduled_task_occurrence_v2",
  );
  assert.match(create, /normalize_scheduled_task_rule_v2/u);
  assert.match(create, /schedule_rule,[\s\S]*v_rule/u);
  assert.match(update, /v_schedule_changed/u);
  assert.match(
    update,
    /cancel_requested_at = case when status = 'running' then now\(\) else null end/u,
  );
  assert.match(update, /state_version = state_version \+ 1/u);
});

test("claim snapshots time semantics and success advances with the v2 recurrence helper", () => {
  const claim = section(
    "create or replace function public.claim_due_scheduled_task_occurrence_v2",
    "create or replace function public.settle_scheduled_task_success_v2",
  );
  const success = section(
    "create or replace function public.settle_scheduled_task_success_v2",
    "revoke all on function public.scheduled_time_zone_is_valid_v2",
  );
  assert.match(claim, /schedule_rule_snapshot/u);
  assert.match(claim, /scheduled_local/u);
  assert.match(claim, /utc_offset_minutes/u);
  assert.match(claim, /missed_count/u);
  assert.match(success, /scheduled_next_occurrence_v2/u);
  assert.match(success, /v_occ\.time_zone/u);
  assert.match(success, /v_occ\.schedule_rule_snapshot/u);
  assert.doesNotMatch(success, /next_scheduled_task_occurrence\(/u);
});

test("time helpers are not exposed to clients and the feature stays disabled", () => {
  for (const name of [
    "scheduled_time_zone_is_valid_v2",
    "normalize_scheduled_task_rule_v2",
    "scheduled_resolve_local_v2",
    "scheduled_next_occurrence_v2",
    "scheduled_coalesce_due_v2",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?authenticated`, "u"),
    );
  }
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
});
