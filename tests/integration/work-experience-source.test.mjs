import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/work.tsx", "utf8");
const server = await readFile("src/lib/work.functions.ts", "utf8");
const teamRoute = await readFile("src/routes/api/agents/teams.ts", "utf8");
const teamServer = await readFile("src/agents/team.server.ts", "utf8");
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

test("both legacy execution queues reject new or resumptive work", () => {
  assert.match(teamRoute, /POST:[\s\S]*?agent_team_execution_unavailable[\s\S]*?status: 503/);
  assert.match(teamRoute, /!\["cancel", "deny"\]\.includes\(body\.command\)/);
  assert.doesNotMatch(teamRoute, /status: 202|createAgentTeamRun/);
  const disabledCreate = teamServer.slice(
    teamServer.indexOf("export async function createAgentTeamRun"),
    teamServer.indexOf("export async function getAgentTeamRuns"),
  );
  assert.match(disabledCreate, /Promise<never>/);
  assert.match(disabledCreate, /agent_team_execution_unavailable/);
  assert.doesNotMatch(disabledCreate, /status: "queued"|\.from\("agent_runs"\)/);
});

test("consequential Work transitions are validated in security-definer RPCs", () => {
  assert.match(migration, /control_agent_job[\s\S]+owner_id=auth\.uid\(\)/);
  assert.match(migration, /decide_agent_approval[\s\S]+status='pending'/);
  assert.match(migration, /p_action <> 'cancel'/);
  assert.match(migration, /p_decision <> 'denied'/);
  assert.match(migration, /grant execute on function public\.decide_agent_approval/);
  assert.match(server, /action: z\.literal\("cancel"\)/);
  assert.match(server, /decision: z\.literal\("denied"\)/);
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
