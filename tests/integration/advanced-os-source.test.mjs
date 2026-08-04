import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(path, "utf8");
test("collaboration is member scoped and supports roles comments mentions and activity", () => {
  const migration = read("supabase/migrations/20260727120000_professional_os.sql"),
    ui = read("src/components/ProjectCollaboration.tsx"),
    project = read("src/routes/projects.$projectId.tsx");
  assert.match(migration, /is_project_member/);
  assert.match(migration, /project_comments/);
  assert.match(ui, /owner/);
  assert.match(ui, /editor/);
  assert.match(ui, /viewer/);
  assert.match(ui, /Mention/);
  assert.match(ui, /My mentions/);
  assert.match(project, /ProjectCollaboration/);
});
test("Research Planner provides editable reusable source-aware plans and real handoffs", () => {
  const route = read("src/routes/research-planner.tsx"),
    fn = read("src/lib/professional.functions.ts");
  assert.match(route, /Move step/);
  assert.match(route, /Website allow list/);
  assert.match(route, /Save template/);
  assert.match(route, /Start Deep Research/);
  assert.match(route, /Continue in Work/);
  assert.match(route, /Continue in Project/);
  assert.match(fn, /research_templates/);
});
test("Knowledge Graph uses only authorized records and explicit edges", () => {
  const route = read("src/routes/knowledge-graph.tsx"),
    fn = read("src/lib/professional.functions.ts");
  for (const value of ["project", "chat", "file", "artifact", "memory", "context"])
    assert.match(route, new RegExp(value));
  assert.match(fn, /requireSupabaseAuth/);
  assert.match(fn, /Included in context pack/);
  assert.match(route, /Open resource/);
  assert.doesNotMatch(route, /Math\.random/);
});
test("Prompt Studio persists variables favorites projects packs and launches chat", () => {
  const route = read("src/routes/prompt-studio.tsx"),
    migration = read("supabase/migrations/20260727120000_professional_os.sql"),
    chat = read("src/routes/index.tsx");
  assert.match(migration, /prompt_templates/);
  assert.match(migration, /user_id=auth\.uid/);
  assert.match(route, /variables/);
  assert.match(route, /favorite/);
  assert.match(route, /Associate Project/);
  assert.match(route, /Attach Context Pack/);
  assert.match(route, /Launch new chat/);
  assert.match(chat, /kova-prompt-launch/);
});
test("Artifact and Work expansions remain truthful and interactive", () => {
  const artifact = read("src/components/ArtifactEditor.tsx"),
    work = read("src/routes/work.tsx");
  assert.match(artifact, /readingMinutes/);
  assert.match(artifact, /Search outline/);
  assert.match(artifact, /Version comparison/);
  assert.match(artifact, /Artifact comments/);
  assert.match(work, /listWorkRuns/);
  assert.match(work, /controlWorkRun/);
  assert.match(work, /Agent execution is unavailable/);
  assert.match(work, /Approval is disabled while execution is unavailable/);
  assert.match(work, /decision: "denied"/);
  assert.doesNotMatch(work, /decision: "approved"|>\s*Approve\s*</);
});
