import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Apollo exposes every specialist and ten real workflow templates", async () => {
  const team = await read("src/agents/team.ts");
  for (const role of ["planner", "research", "browser", "file", "coding", "writing", "review"])
    assert.match(team, new RegExp(`"${role}"`));
  for (const workflow of [
    "Research Report",
    "Website Audit",
    "Competitor Analysis",
    "Code Review",
    "Marketing Plan",
    "Financial Summary",
    "Meeting Preparation",
    "Bug Investigation",
    "Shopping Research",
    "Travel Planner",
  ])
    assert.match(team, new RegExp(workflow));
  assert.match(team, /Task graph contains a cycle/);
  assert.match(team, /depends on missing task/);
});

test("agent teams are server gated, dependency aware, unavailable, and safely controllable", async () => {
  const server = await read("src/agents/team.server.ts");
  assert.match(server, /getAgentEntitlement/);
  assert.match(server, /entitlement === "plus" \? 4/);
  assert.match(server, /parallelism: limits\.concurrency/);
  assert.match(server, /browser_agent_unavailable/);
  assert.match(server, /\["pause", "resume", "retry", "approve"\]/);
  for (const command of ["cancel", "deny"]) assert.match(server, new RegExp(`"${command}"`));
});

test("legacy specialist worker fails closed without browser or model execution", async () => {
  const worker = await read("workers/agent-team-worker.mjs");
  assert.match(worker, /legacy agent_runs specialist worker is disabled/);
  assert.match(worker, /agent execution is unavailable/);
  assert.doesNotMatch(worker, /chromium\.launch|chat\/completions|agent_run_tasks/);
});

test("agent team creation fails closed while worker execution is disabled", async () => {
  const [api, workspace] = await Promise.all([
    read("src/routes/api/agents/teams.ts"),
    read("src/components/AgentTeamWorkspace.tsx"),
  ]);
  assert.doesNotMatch(api, /createAgentTeamRun/);
  assert.match(api, /browser_agent_unavailable/);
  assert.match(api, /status: 503/);
  assert.match(api, /Retry-After/);
  assert.match(workspace, /EXECUTION_DISABLED_MESSAGE/);
  assert.match(workspace, /Agent teams unavailable/);
  assert.match(workspace, /Approval disabled/);
  assert.doesNotMatch(workspace, /Retry failed/);
});
