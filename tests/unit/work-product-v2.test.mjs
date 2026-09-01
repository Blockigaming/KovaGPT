import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const functions = readFileSync("src/lib/work.functions.ts", "utf8");
const route = readFileSync("src/routes/work.tsx", "utf8");
const composer = readFileSync("src/components/WorkRunComposer.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260901010000_work_execution_v2.sql",
  "utf8",
);

test("Work runtime stays source-disabled and requires an explicit deployment flag", () => {
  assert.match(functions, /export const workExecutionAvailable = false;/u);
  assert.match(functions, /export function workExecutionRuntimeAvailable/u);
  assert.match(functions, /process\.env\.KOVA_WORK_EXECUTION_ENABLED/u);
  assert.match(functions, /requireWorkRuntime\(\)/u);
  assert.match(migration, /set enabled = false/u);
});

test("model-only Work creation uses the owner RPC with bounded fixed policy", () => {
  assert.match(functions, /export const createWorkRun = createServerFn/u);
  assert.match(functions, /objective: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(12000\)/u);
  assert.match(functions, /idempotencyKey: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(200\)/u);
  assert.match(functions, /owner_create_work_job_v2/u);
  assert.match(functions, /p_allowed_domains: \[\]/u);
  assert.match(functions, /p_tool_policy: \{ allowed_tools: \[\] \}/u);
  assert.match(functions, /p_token_budget: 12000/u);
});

test("lifecycle controls use Work v2 RPCs only when runtime activation is explicit", () => {
  assert.match(functions, /action: z\.enum\(\["pause", "resume", "cancel", "delete"\]\)/u);
  assert.match(functions, /if \(workExecutionRuntimeAvailable\(\)\)/u);
  assert.match(functions, /owner_control_work_job_v2/u);
  assert.match(functions, /if \(data\.action !== "cancel"\)/u);
  assert.match(functions, /control_agent_job/u);
});

test("approval can be approved only through active Work v2 while legacy history can still be denied", () => {
  assert.match(functions, /decision: z\.enum\(\["approved", "denied"\]\)/u);
  assert.match(functions, /owner_decide_work_approval_v2/u);
  assert.match(functions, /if \(data\.decision !== "denied"\)/u);
  assert.match(functions, /decide_agent_approval/u);
});

test("the Work page discovers runtime capability instead of assuming execution is available", () => {
  assert.match(route, /getWorkExecutionAvailability/u);
  assert.match(route, /setExecutionAvailable\(result\.executionAvailable === true\)/u);
  assert.match(route, /setExecutionAvailable\(false\)/u);
  assert.match(route, /executionAvailable \? \(/u);
  assert.match(route, /<WorkRunComposer/u);
  assert.match(route, /Agent execution is unavailable/u);
});

test("the Work page exposes pause resume cancel delete and bounded approval controls", () => {
  assert.match(route, /runAction\("pause"\)/u);
  assert.match(route, /runAction\("resume"\)/u);
  assert.match(route, /runAction\("cancel"\)/u);
  assert.match(route, /runAction\("delete"\)/u);
  assert.match(route, /decidePending\(a\.id, "approved"\)/u);
  assert.match(route, /decidePending\(a\.id, "denied"\)/u);
  assert.match(route, /executionAvailable=\{executionAvailable\}/u);
});

test("the composer describes its real model-only boundary and creates idempotent runs", () => {
  assert.match(composer, /Start model-only Work/u);
  assert.match(composer, /Browser and external tool actions remain unavailable/u);
  assert.match(composer, /crypto\.randomUUID\(\)/u);
  assert.match(composer, /maxLength=\{12000\}/u);
  assert.match(composer, /createWorkRun/u);
  assert.doesNotMatch(composer, /allowedDomains|allowed_tools|browser\.navigate/u);
});
