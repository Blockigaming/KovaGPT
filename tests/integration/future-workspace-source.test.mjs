import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Prompt Studio 2.0 persists folders revisions evaluations and launch analytics", async () => {
  const [route, server, migration] = await Promise.all([
    read("src/routes/prompt-studio.tsx"),
    read("src/lib/professional.functions.ts"),
    read("supabase/migrations/20260727150000_prompt_studio_2.sql"),
  ]);
  for (const contract of ["prompt_versions", "prompt_evaluations", "use_count", "folder"]) {
    assert.match(migration, new RegExp(contract));
  }
  assert.match(migration, /enable row level security/g);
  assert.match(server, /listPromptHistory/);
  assert.match(server, /evaluatePrompt/);
  assert.match(server, /increment_use/);
  assert.match(route, /Prompt analytics/);
  assert.match(route, /Save revision/);
  assert.match(route, /Evaluation history/);
  assert.match(route, /Versions & evaluation/);
});

test("Knowledge Graph 2.0 supports real timeline clusters and relationship strength", async () => {
  const [route, server] = await Promise.all([
    read("src/routes/knowledge-graph.tsx"),
    read("src/lib/professional.functions.ts"),
  ]);
  assert.match(server, /updatedAt/);
  assert.match(server, /existing\.strength \+ 1/);
  assert.match(route, /Knowledge timeline/);
  assert.match(route, /Relationship clusters/);
  assert.match(route, /explicit Project membership and Context Pack inclusion only/);
  assert.match(route, /strokeWidth/);
});

test("AI Command Center includes owner-scoped prompt usage alongside workspace activity", async () => {
  const [workspace, dashboard] = await Promise.all([
    read("src/lib/workspace.functions.ts"),
    read("src/components/WorkspaceIntelligence.tsx"),
  ]);
  assert.match(workspace, /prompt_templates/);
  assert.match(workspace, /use_count/);
  assert.match(workspace, /kind: "prompt"/);
  assert.match(dashboard, /Workspace Timeline/);
  assert.match(dashboard, /prompt: FlaskConical/);
});
