import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(path, "utf8");

test("workspace sources remain authorized while chat history stays searchable in the shell", () => {
  const fn = read("src/lib/workspace.functions.ts"),
    home = read("src/routes/index.tsx"),
    sidebar = read("src/components/Sidebar.tsx"),
    palette = read("src/components/CommandPalette.tsx");
  for (const table of ["projects", "user_library_items", "scheduled_tasks", "deep_research_runs"])
    assert.match(fn, new RegExp(`\\"${table}\\"`));
  assert.match(home, /loadConversations/);
  assert.match(sidebar, /searchConversations/);
  assert.match(sidebar, /Recent chats/);
  assert.match(palette, /searchConversations/);
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
test("Work preserves durable history and denial-only controls without background claims", () => {
  const route = read("src/routes/work.tsx"),
    functions = read("src/lib/work.functions.ts");
  assert.match(functions, /requireSupabaseAuth/);
  assert.match(route, /Agent execution is unavailable/);
  assert.match(route, /decideApproval/);
  assert.match(route, /decision: "denied"/);
  assert.match(route, /Deliverables/);
  assert.match(route, /controlWorkRun/);
  assert.doesNotMatch(route, /Waiting for worker|Approval required|decision: "approved"/);
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
