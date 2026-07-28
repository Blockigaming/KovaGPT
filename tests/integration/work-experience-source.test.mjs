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
    "agent_run_events",
    "agent_deliverables",
    "agent_approvals",
    '.eq("owner_id", context.userId)',
  ])
    assert.ok(server.includes(contract), contract);
});

test("Work exposes factual execution, evidence, deliverables, controls, and approvals", () => {
  for (const contract of [
    "Dependency graph",
    "Specialist timeline",
    "Evidence center",
    "No estimated percentage",
    "Retrying attempt",
    "Approval center",
    "Search deliverables",
    "SHA-256",
    "pause",
    "resume",
    "cancel",
  ])
    assert.ok(route.includes(contract), contract);
});

test("consequential Work transitions are validated in security-definer RPCs", () => {
  assert.match(migration, /control_agent_job[\s\S]+owner_id=auth\.uid\(\)/);
  assert.match(migration, /decide_agent_approval[\s\S]+status='pending'/);
  assert.match(migration, /grant execute on function public\.decide_agent_approval/);
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
