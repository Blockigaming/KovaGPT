import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Work exposes the persisted specialist graph and live server timeline", async () => {
  const [route, functions] = await Promise.all([
    read("src/routes/work.tsx"),
    read("src/lib/work.functions.ts"),
  ]);
  assert.match(route, /DependencyGraph/);
  assert.match(route, /Timeline/);
  assert.match(route, /Evidence/);
  assert.match(route, /Approvals/);
  assert.match(route, /useServerFn\(getWorkRun\)/);
  assert.match(functions, /agent_specialist_tasks/);
  assert.match(functions, /agent_dependency_edges/);
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

test("legacy agent_runs specialist execution fails closed", async () => {
  const worker = await read("workers/agent-team-worker.mjs");
  assert.match(worker, /legacy agent_runs specialist worker is disabled/);
  assert.match(worker, /agent execution is unavailable/);
  assert.doesNotMatch(worker, /OPENAI_API_KEY|chromium|createClient|while \(true\)/);
});
