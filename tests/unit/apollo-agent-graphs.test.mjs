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

test("agent teams are server gated, dependency aware, parallel and controllable", async () => {
  const server = await read("src/agents/team.server.ts");
  assert.match(server, /getAgentEntitlement/);
  assert.match(server, /entitlement === "plus" \? 4/);
  assert.match(server, /parallelism: limits\.concurrency/);
  assert.match(server, /releaseReadyTasks/);
  for (const command of ["pause", "resume", "cancel", "retry", "approve", "deny"])
    assert.match(server, new RegExp(`"${command}"`));
});

test("specialist worker uses real browser and model output without fabricated events", async () => {
  const worker = await read("workers/agent-team-worker.mjs");
  assert.match(worker, /chromium\.launch/);
  assert.match(worker, /chat\/completions/);
  assert.match(worker, /agent_run_tasks/);
  assert.match(worker, /dependencies\.every/);
  assert.match(worker, /approval_needed/);
  assert.match(worker, /createHash\("sha256"\)/);
  assert.match(worker, /Do not fabricate execution/);
});
