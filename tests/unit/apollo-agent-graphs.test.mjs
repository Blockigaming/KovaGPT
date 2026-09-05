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

test("legacy agent teams fail closed while no compatible worker exists", async () => {
  const server = await read("src/agents/team.server.ts");
  assert.match(server, /createAgentTeamRun[\s\S]*agent_team_execution_unavailable/);
  assert.match(server, /command !== "cancel" && command !== "deny"/);
  assert.doesNotMatch(server, /getAgentEntitlement|releaseReadyTasks|parallelism:/);
});

test("legacy specialist worker fails closed without browser or model execution", async () => {
  const worker = await read("workers/agent-team-worker.mjs");
  assert.match(worker, /legacy agent_runs specialist worker is disabled/);
  assert.match(worker, /agent execution is unavailable/);
  assert.doesNotMatch(worker, /chromium\.launch|chat\/completions|agent_run_tasks/);
});
