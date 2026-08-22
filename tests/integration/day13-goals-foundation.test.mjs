import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Day 13 goals are durable, owner scoped, and RLS protected", () => {
  const migration = read("supabase/migrations/20260822122000_day13_goals.sql");

  assert.match(migration, /create table if not exists public\.goals/);
  assert.match(migration, /owner_id uuid not null references auth\.users/);
  assert.match(migration, /alter table public\.goals enable row level security/);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(migration, /create table if not exists public\.goal_milestones/);
});

test("Goals server functions authenticate and pin writes to the caller", () => {
  const source = read("src/lib/goals.functions.ts");

  assert.match(source, /requireSupabaseAuth/);
  assert.match(source, /owner_id: context\.userId/);
  assert.match(source, /\.eq\("owner_id", context\.userId\)/);
  assert.match(source, /createGoal/);
  assert.match(source, /updateGoal/);
  assert.match(source, /deleteGoal/);
  assert.match(source, /createGoalMilestone/);
});

test("Workspace Intelligence includes factual goal signals", () => {
  const workspace = read("src/lib/workspace.functions.ts");
  const dashboard = read("src/components/WorkspaceIntelligence.tsx");

  assert.match(workspace, /\| "goal"/);
  assert.match(workspace, /table\(context\.supabase, "goals"\)/);
  assert.match(workspace, /kind: "goal"/);
  assert.match(workspace, /href: "\/goals"/);
  assert.match(dashboard, /goal: Target/);
});

test("Goals UI uses the real authenticated server flow", () => {
  const route = read("src/routes/goals.tsx");

  assert.match(route, /createFileRoute\("\/goals"\)/);
  assert.match(route, /useServerFn\(listGoals\)/);
  assert.match(route, /useServerFn\(createGoal\)/);
  assert.match(route, /useServerFn\(updateGoal\)/);
  assert.match(route, /useServerFn\(createGoalMilestone\)/);
  assert.match(route, /Kova only uses goals you explicitly save/);
});
