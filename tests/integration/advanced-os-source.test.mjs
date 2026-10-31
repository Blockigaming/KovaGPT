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
test("Artifact tools remain interactive while retired Work links return to chat", () => {
  const artifact = read("src/components/ArtifactEditor.tsx"),
    work = read("src/routes/work.tsx");
  for (const label of [
    "readingMinutes",
    "Search outline",
    "Version comparison",
    "Artifact comments",
    "Continue in chat",
  ])
    assert.ok(artifact.includes(label), label);
  assert.match(work, /throw redirect\(\{ to: "\/", replace: true \}\)/);
  assert.doesNotMatch(work, /<WorkExecutionPanel|<AgentWorkspace|decision: "approved"/);
});
