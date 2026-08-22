import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Kova Brain is authenticated and aggregates existing authorized systems", () => {
  const source = read("src/lib/kova-brain.functions.ts");

  assert.match(source, /getKovaBrainSnapshot/);
  assert.match(source, /requireSupabaseAuth/);

  for (const table of [
    "goals",
    "scheduled_tasks",
    "project_members",
    "project_tasks",
    "deep_research_runs",
    "project_memory",
    "context_packs",
    "user_library_items",
  ]) {
    assert.match(source, new RegExp(`"${table}"`));
  }

  assert.match(source, /\.eq\("owner_id", context\.userId\)/);
  assert.match(source, /\.eq\("user_id", context\.userId\)/);
});

test("Daily Briefing is derived from factual goal task and research state", () => {
  const source = read("src/lib/kova-brain.functions.ts");

  assert.match(source, /briefing: BrainBriefingItem\[\]/);
  assert.match(source, /overdueTasks/);
  assert.match(source, /soonTasks/);
  assert.match(source, /upcomingGoals/);
  assert.match(source, /Research status:/);
  assert.match(source, /No urgent workspace items detected/);
});

test("Predictive Assistance is deterministic and exposes its evidence", () => {
  const source = read("src/lib/kova-brain.functions.ts");

  assert.match(source, /suggestions: BrainSuggestion\[\]/);
  assert.match(source, /evidence:/);
  assert.match(source, /resolve-overdue-tasks/);
  assert.match(source, /focus-upcoming-goals/);
  assert.match(source, /review-stalled-goals/);
  assert.match(source, /create-first-goal/);
  assert.doesNotMatch(source, /openai/i);
  assert.doesNotMatch(source, /anthropic/i);
});

test("Kova Brain UI distinguishes facts from suggestions", () => {
  const route = read("src/routes/brain.tsx");

  assert.match(route, /createFileRoute\("\/brain"\)/);
  assert.match(route, /Daily Briefing/);
  assert.match(route, /Predictive Assistance/);
  assert.match(route, /Why Kova suggested this/);
  assert.match(route, /No values are invented/);
  assert.match(route, /No fake predictions/);
});

test("Workspace Intelligence exposes Kova Brain without replacing Library", () => {
  const dashboard = read("src/components/WorkspaceIntelligence.tsx");

  assert.match(dashboard, /Open Kova Brain/);
  assert.match(dashboard, /to="\/brain"/);
  assert.match(dashboard, /View full library/);
});
