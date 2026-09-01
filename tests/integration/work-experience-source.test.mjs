import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/work.tsx", "utf8");
const server = await readFile("src/lib/work.functions.ts", "utf8");
const migration = await readFile(
  "supabase/migrations/20260728090000_helios_agent_runtime.sql",
  "utf8",
);

test("Work is loaded from persisted runs, events, deliverables, and approvals", () => {
  for (const contract of [
    "agent_jobs",
    "agent_job_events",
    "agent_deliverables",
    "agent_approvals",
    '.eq("owner_id", context.userId)',
  ])
    assert.ok(server.includes(contract), contract);
});

test("Work exposes historical evidence and fail-closed controls", () => {
  for (const contract of [
    "Dependency graph",
    "Specialist timeline",
    "Evidence center",
    "No estimated percentage",
    "Approval center",
    "Search deliverables",
    "SHA-256",
    "Agent execution is unavailable",
    "cancel",
  ])
    assert.ok(route.includes(contract), contract);
});

test("legacy controls stay fail-closed while Work v2 lifecycle transitions are runtime-gated", () => {
  assert.match(migration, /control_agent_job[\s\S]+owner_id=auth\.uid\(\)/);
  assert.match(migration, /decide_agent_approval[\s\S]+status='pending'/);
  assert.match(migration, /p_action <> 'cancel'/);
  assert.match(migration, /p_decision <> 'denied'/);
  assert.match(migration, /grant execute on function public\.decide_agent_approval/);

  assert.match(server, /export const workExecutionAvailable = false/u);
  assert.match(server, /workExecutionRuntimeAvailable/u);
  assert.match(server, /action: z\.enum\(\["pause", "resume", "cancel", "delete"\]\)/u);
  assert.match(server, /decision: z\.enum\(\["approved", "denied"\]\)/u);
  assert.match(server, /owner_control_work_job_v2/u);
  assert.match(server, /owner_decide_work_approval_v2/u);
  assert.match(server, /if \(data\.action !== "cancel"\)/u);
  assert.match(server, /if \(data\.decision !== "denied"\)/u);
});

test("Work graph, evidence, inspector, and revision controls are interactive", () => {
  for (const contract of [
    "Graph minimap",
    "Interactive dependency graph",
    "Specialist inspector",
    "onPointerMove",
    "Stored DOM snapshot",
    "Timeline through",
    "Evidence specialist",
    "Version history",
    "restoreDeliverableRevision",
  ])
    assert.ok(route.includes(contract), contract);
  assert.match(server, /createSignedUrl\(storagePath, 300\)/);
  assert.match(server, /listDeliverableVersions/);
});
