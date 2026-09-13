import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("attributed analytics are owner and definition scoped, bounded, and content free", async () => {
  const source = await read("src/lib/agent-analytics.functions.ts");
  assert.match(source, /requireSupabaseAuth/);
  assert.match(source, /\.eq\("owner_id", context\.userId\)/);
  assert.match(source, /\.eq\("agent_definition_id", data\.id\)/);
  assert.match(source, /\.limit\(500\)/);
  assert.doesNotMatch(source, /objective|instructions|prompt|safe_payload/);
  assert.match(source, /runs\.length >= 5/);
  assert.match(source, /runtimes\.length >= 10/);
});
test("agent runs reject stale versions and omit objectives from operational events", async () => {
  const server = await read("src/agents/execution.server.ts");
  const api = await read("src/routes/api/agents/runs.ts");
  assert.match(server, /agent_definition_version_conflict/);
  assert.match(server, /expectedDefinitionVersion !== definition\.version/);
  assert.doesNotMatch(server, /safe_payload: \{\s*objective:/s);
  assert.match(api, /expectedDefinitionVersion/);
  assert.match(server, /agent_run_not_cancellable/);
  assert.match(server, /supabaseUser\.rpc\("control_disabled_browser_run"/);
  assert.doesNotMatch(server, /command === "cancel" && safeRun.status === "cancelled"/);
  assert.match(server, /idempotencyKey: `retry:\$\{runId\}:\$\{retryKey\}`/);
  assert.match(server, /priorRunId: runId/);
  assert.match(server, /if \(!data\) throw new Error\("agent_control_unavailable"\)/);
});
test("knowledge provenance is owner scoped, confidence bounded, and suggestions require approval", async () => {
  const sql = await read("supabase/migrations/20260803100000_knowledge_provenance.sql");
  const server = await read("src/lib/knowledge-provenance.functions.ts");
  assert.match(sql, /confidence between 0 and 1/);
  assert.match(sql, /model-suggested/);
  assert.match(sql, /auth\.uid\(\)=owner_id/g);
  assert.match(
    sql,
    /unique\(owner_id,source_type,source_id,target_type,target_id,relationship_type\)/,
  );
  assert.match(server, /Both knowledge records must belong to your account/);
  assert.match(server, /pending = data\.derivationMethod === "model-suggested"/);
  assert.match(server, /decision: z\.enum\(\["approve", "reject", "archive", "restore"\]\)/);
  assert.match(server, /\.select\("id"\)\s*\.maybeSingle\(\)/);
});
test("analytics UI is lazy, textual, range bounded, and exports metadata only", async () => {
  const route = await read("src/routes/omega.tsx");
  const ui = await read("src/components/AgentAnalyticsDialog.tsx");
  assert.match(route, /import\("@\/components\/AgentAnalyticsDialog"\)/);
  assert.match(ui, /Agent analytics summary/);
  assert.match(ui, /Not enough data/);
  assert.match(ui, /Export metadata CSV/);
  assert.doesNotMatch(ui, /run\.objective|run\.prompt|run\.message|run\.safe_payload/);
  assert.match(ui, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/);
});
