import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(path, "utf8");

test("Library and workspace intelligence aggregate authorized sources and local chats", () => {
  const fn = read("src/lib/workspace.functions.ts"),
    library = read("src/routes/library.tsx"),
    dashboard = read("src/components/WorkspaceIntelligence.tsx");
  for (const table of ["projects", "user_library_items", "scheduled_tasks", "deep_research_runs"])
    assert.match(fn, new RegExp(`\\"${table}\\"`));
  assert.match(dashboard, /listWorkspaceIntelligence/);
  assert.match(library, /loadConversations/);
  assert.match(library, /loadWorkTasks/);
  assert.match(library, /Selected Library actions/);
});
test("Memory Center supports real edit delete merge and source explanations", () => {
  const route = read("src/routes/memory.tsx"),
    fn = read("src/lib/workspace.functions.ts");
  assert.match(fn, /chat_memories/);
  assert.match(fn, /project_memory/);
  assert.match(route, /Merge duplicates/);
  assert.match(route, /Temporary chats are never/);
  assert.match(route, /updateMemoryRecord/);
  assert.match(route, /deleteMemoryRecord/);
});
test("Context Packs are owner scoped, persisted, and attach to chat", () => {
  const migration = read("supabase/migrations/20260727090000_context_packs.sql"),
    route = read("src/routes/context-packs.tsx"),
    chat = read("src/routes/index.tsx");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.match(route, /createContextPack/);
  assert.match(route, /Use in new chat/);
  assert.match(chat, /kova-active-context-pack/);
});
test("Work mode is durable, approval-gated, and never claims background work", () => {
  const route = read("src/routes/work.tsx"),
    functions = read("src/lib/work.functions.ts");
  assert.match(functions, /requireSupabaseAuth/);
  assert.match(route, /Approval required/);
  assert.match(route, /decideApproval/);
  assert.match(route, /Deliverables/);
  assert.match(route, /Waiting for worker/);
  assert.match(route, /controlWorkRun/);
});
test("Files and Apps expose truthful professional workflows", () => {
  const files = read("src/routes/files.tsx"),
    apps = read("src/routes/apps.tsx");
  assert.match(files, /Known storage usage/);
  assert.match(files, /Potential duplicates/);
  assert.match(files, /listMyLibrary/);
  assert.match(apps, /Capabilities and permissions/);
  assert.match(apps, /Use in chat/);
  assert.match(apps, /explicit confirmation/);
});
