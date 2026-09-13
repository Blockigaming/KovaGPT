import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("workspace intelligence aggregates only authenticated existing workspace tables", async () => {
  const source = await read("src/lib/workspace.functions.ts");
  assert.match(source, /listWorkspaceIntelligence/);
  for (const table of [
    "projects",
    "project_chats",
    "project_files",
    "user_library_items",
    "project_memory",
    "context_packs",
    "deep_research_runs",
    "scheduled_tasks",
  ]) {
    assert.match(source, new RegExp(`\"${table}\"`));
  }
  assert.match(source, /requireSupabaseAuth/);
  assert.doesNotMatch(source, /recommended for you/i);
});

test("projects, work, research, and automations share real workspace signals", async () => {
  const [project, work, research, tasks] = await Promise.all([
    read("src/routes/projects.$projectId.tsx"),
    read("src/routes/work.tsx"),
    read("src/routes/research-planner.tsx"),
    read("src/routes/scheduled-tasks.tsx"),
  ]);
  assert.match(project, /Connected project work/);
  assert.match(work, /Recent context for Work/);
  assert.match(research, /Research context/);
  assert.match(tasks, /Context for automations/);
});

test("workspace resources have reduced-click truthful handoffs", async () => {
  const [handoffs, library, files, memory, artifact, packs] = await Promise.all([
    read("src/lib/workspace-handoffs.ts"),
    read("src/routes/library.tsx"),
    read("src/routes/files.tsx"),
    read("src/routes/memory.tsx"),
    read("src/components/ArtifactEditor.tsx"),
    read("src/routes/context-packs.tsx"),
  ]);
  for (const source of [library, files, memory, artifact]) {
    assert.match(source, /openInWork/);
    assert.match(source, /continueInResearch/);
    assert.match(source, /addToContextPack/);
  }
  assert.match(handoffs, /kova-work-draft/);
  assert.match(handoffs, /kova-research-draft/);
  assert.match(packs, /Use in Research/);
  for (const type of ["artifact", "image", "research", "prompt", "work"]) {
    assert.match(packs, new RegExp(`\"${type}\"`));
  }
});

test("chat history is searchable from both the sidebar and command palette", async () => {
  const [home, sidebar, palette, search] = await Promise.all([
    read("src/routes/index.tsx"),
    read("src/components/Sidebar.tsx"),
    read("src/components/CommandPalette.tsx"),
    read("src/lib/conversation-search.ts"),
  ]);
  assert.match(home, /loadConversations/);
  assert.match(sidebar, /searchConversations/);
  assert.match(palette, /searchConversations/);
  assert.match(search, /message\.content/);
  assert.match(search, /is:pinned/);
  assert.match(palette, /useDeferredValue/);
  assert.match(palette, /archivedConversations/);
  assert.match(palette, /returnFocusRef/);
  assert.match(home, /onSelectArchived/);
});

test("gap ledger separates autonomous work, unavailable scope, and owner activation", async () => {
  const ledger = await read("docs/remaining-chatgpt-gaps.md");
  for (const category of [
    "Highest-priority autonomous source work",
    "Required but currently unavailable",
    "Genuine owner or approved-live dependencies",
    "Permanent truth boundaries",
  ]) {
    assert.ok(ledger.includes(category), `missing gap category: ${category}`);
  }
  for (const priority of [1, 2, 3, 4]) {
    assert.match(ledger, new RegExp(`\\| ${priority}\\s+\\|`));
  }
  for (const requirement of ["FG-07", "FG-X1", "FG-10", "FG-09"]) {
    assert.match(ledger, new RegExp(requirement));
  }
  assert.match(ledger, /owner-declared \*\*76\.5%\*\*/i);
  assert.match(ledger, /specified, implemented, locally verified, hosted verified/i);
  assert.match(ledger, /Do not merge PR #319, deploy, apply live migrations/i);
});

test("Workspace Timeline and batch context workflows use existing authorized records", async () => {
  const [dashboard, handoffs, files, library, packs] = await Promise.all([
    read("src/components/WorkspaceIntelligence.tsx"),
    read("src/lib/workspace-handoffs.ts"),
    read("src/routes/files.tsx"),
    read("src/routes/library.tsx"),
    read("src/routes/context-packs.tsx"),
  ]);
  assert.match(dashboard, /WorkspaceTimeline/);
  assert.match(dashboard, /7, 30, 90/);
  assert.match(dashboard, /A factual replay of activity/);
  assert.match(dashboard, /Export CSV/);
  assert.match(handoffs, /addManyToContextPack/);
  assert.match(handoffs, /new Map/);
  assert.match(files, /files selected/);
  assert.match(library, /Selected Library actions/);
  assert.match(library, /deleteSelected/);
  assert.match(packs, /kova-context-candidates/);
});
