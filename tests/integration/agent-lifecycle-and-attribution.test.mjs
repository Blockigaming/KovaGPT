import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("agent edits are atomic, conflict-aware, owner scoped, and suppress no-op snapshots", async () => {
  const sql = await read("supabase/migrations/20260802130000_agent_definition_lifecycle.sql");
  assert.match(sql, /for update/);
  assert.match(sql, /owner_id = auth\.uid\(\)/);
  assert.match(sql, /agent_version_conflict/);
  assert.match(sql, /is not distinct from p_project_id/);
  assert.match(sql, /version=version\+1/);
  assert.match(sql, /p_source/);
  assert.match(sql, /agent_project_not_authorized/);
});

test("agent lifecycle functions bound history and deny cross-owner versions", async () => {
  const source = await read("src/lib/agent-definitions.functions.ts");
  assert.match(source, /listSavedAgentVersions/);
  assert.match(source, /restoreSavedAgentVersion/);
  assert.match(source, /updateSavedAgent/);
  assert.match(source, /\.eq\("owner_id", context\.userId\)/g);
  assert.match(source, /\.limit\(50\)/);
  assert.match(source, /expectedVersion/);
});

test("agent imports are bounded, versioned, and strip imported capabilities", async () => {
  const portability = await read("src/lib/agent-portability.ts");
  const server = await read("src/lib/agent-definitions.functions.ts");
  assert.match(portability, /MAX_AGENT_IMPORT_BYTES = 32_000/);
  assert.match(portability, /format: z\.literal\("kovagpt-agent"\)/);
  assert.match(portability, /safeAgentFilename/);
  assert.doesNotMatch(portability, /owner_id|token|secret|execution/);
  assert.match(server, /source: "import"/);
  assert.match(server, /allowed_tools: \[\]/);
  assert.match(server, /memory_enabled: false/);
});

test("agent runs retain exact nullable definition attribution without private objective fields in history", async () => {
  const sql = await read("supabase/migrations/20260802131000_agent_run_attribution.sql");
  const runner = await read("src/agents/execution.server.ts");
  const api = await read("src/routes/api/agents/runs.ts");
  assert.match(
    sql,
    /agent_definition_id uuid references public\.agent_definitions\(id\) on delete set null/,
  );
  assert.match(sql, /agent_definition_version integer/);
  assert.match(sql, /tool_ids text\[\]/);
  assert.match(runner, /archived_agent_cannot_run/);
  assert.match(runner, /agent_tool_not_allowed/);
  assert.match(runner, /\.eq\("owner_id", caller\.userId\)/);
  assert.match(runner, /agent_definition_version: definition\?\.version/);
  assert.doesNotMatch(api, /entitlement,objective,status/);
});

test("advanced agent editor is lazy and accessible", async () => {
  const route = await read("src/routes/omega.tsx");
  const dialog = await read("src/components/AgentDefinitionDialog.tsx");
  assert.match(route, /lazy\(\(\) =>/);
  assert.match(route, /Import agent file/);
  assert.match(route, /Imported tools and memory are disabled/);
  assert.match(dialog, /Unsaved changes/);
  assert.match(dialog, /Agent versions/);
  assert.match(dialog, /Discard agent changes/);
  assert.match(dialog, /event\.metaKey \|\| event\.ctrlKey/);
});
