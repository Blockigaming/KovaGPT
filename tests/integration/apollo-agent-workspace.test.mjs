import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Work exposes template selection, task graph editing and live server timeline", async () => {
  const [workspace, route] = await Promise.all([
    read("src/components/AgentTeamWorkspace.tsx"),
    read("src/routes/work.tsx"),
  ]);
  assert.match(route, /<AgentTeamWorkspace \/>/);
  assert.match(workspace, /Direct an agent team/);
  assert.match(workspace, /Launch \{tasks\.length\} specialists/);
  assert.match(workspace, /Live specialist timeline/);
  assert.match(workspace, /Evidence and deliverables/);
  assert.match(workspace, /screenshotUrl/);
  assert.match(workspace, /window\.setInterval/);
  assert.match(workspace, /Approve checkpoint/);
});

test("Apollo migration persists parent tasks, dependencies, retries, outputs and checkpoints", async () => {
  const migration = await read("supabase/migrations/20260727230000_apollo_agent_graphs.sql");
  for (const field of [
    "parent_task_id",
    "dependencies",
    "max_attempts",
    "checkpoint",
    "progress",
    "output_text",
    "lease_owner",
  ])
    assert.match(migration, new RegExp(field));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(migration, /agent-evidence/);
});

test("specialists receive only owner-scoped workspace context", async () => {
  const worker = await read("workers/agent-team-worker.mjs");
  assert.match(worker, /eq\("owner_id", task\.owner_id\)/);
  assert.match(worker, /eq\("uploaded_by", task\.owner_id\)/);
  assert.match(worker, /eq\("user_id", task\.owner_id\)/);
  assert.match(worker, /authorizedWorkspaceContext/);
});
