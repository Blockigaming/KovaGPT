import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("agent state changes are compare-and-set and do not report false success", async () => {
  const source = await read("src/agents/execution.server.ts");
  assert.match(source, /\.eq\("status", safeRun\.status\)/);
  assert.match(source, /transitionError \|\| !transitioned/);
  assert.match(source, /agent_run_state_changed/);
  assert.match(source, /eventError/);
});
test("knowledge decisions reject missing or cross-owner rows and graph avoids unsupported controls", async () => {
  const server = await read("src/lib/knowledge-provenance.functions.ts");
  const route = await read("src/routes/knowledge-graph.tsx");
  assert.match(
    server,
    /\.eq\("owner_id", context\.userId\)\s*\.select\("id"\)\s*\.maybeSingle\(\)/,
  );
  assert.match(server, /result\.error \|\| !result\.data/);
  assert.match(route, /Knowledge graph could not be loaded/);
  assert.doesNotMatch(route, /Approve relationship|Reject relationship/);
});
test("client workspace failures are presented without dumping raw records", async () => {
  for (const path of [
    "src/routes/projects.tsx",
    "src/routes/library.tsx",
    "src/routes/projects.$projectId.tsx",
    "src/routes/projects.$projectId.chat.$chatId.tsx",
    "src/components/SettingsDialog.tsx",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /console\.(error|warn|log)\(e\)/, path);
  }
});
