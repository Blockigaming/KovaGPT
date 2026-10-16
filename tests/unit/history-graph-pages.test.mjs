import assert from "node:assert/strict";
import test from "node:test";
import { loadServerFunctions } from "../helpers/server-function-harness.mjs";
const api = loadServerFunctions(
  process.env.KOVA_HISTORY_GRAPH_SOURCE ?? "src/lib/professional.functions.ts",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const calls = [];
  const client = {
    from(table) {
      let cursor = null,
        limit = 0,
        owner = null,
        prompt = null;
      const q = {
        select: (_cols, options) => {
          assert.equal(options?.count, undefined);
          return q;
        },
        eq: (key, value) => {
          if (key === "user_id") owner = value;
          if (key === "prompt_id") prompt = value;
          return q;
        },
        order: () => q,
        gt: (_key, value) => {
          cursor = value;
          return q;
        },
        limit: (value) => {
          limit = value;
          return q;
        },
        abortSignal: () => q,
        then(resolve, reject) {
          calls.push({ table, cursor, limit, owner, prompt });
          const first = cursor ? Number(cursor.slice(-12)) + 1 : 1;
          return Promise.resolve({
            data: Array.from({ length: Math.min(limit, 7) }, (_, n) => ({
              id: id(first + n),
              project_id: id(1),
              name: "Record",
              title: "Title",
              content: "Memory",
              items: [],
              created_at: "2026-10-12T00:00:00Z",
              updated_at: "2026-10-12T00:00:00Z",
            })),
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { calls, context: { supabase: client, userId: "actor" } };
}
test("history reaches older versions and evaluations using one bounded source page per action", async () => {
  const f = fixture();
  for (const source of ["versions", "evaluations"]) {
    let cursor = null;
    for (let action = 0; action < 10; action++) {
      const before = f.calls.length;
      const page = await api.listPromptHistory({
        data: { prompt_id: id(99), source, cursor },
        context: f.context,
      });
      assert.equal(f.calls.length - before, 1);
      assert.equal(page[source].length, 7);
      cursor = source === "versions" ? page.versionCursor : page.evaluationCursor;
      assert.ok(cursor);
    }
  }
  for (const call of f.calls) {
    assert.equal(call.owner, "actor");
    assert.equal(call.prompt, id(99));
    assert.equal(call.limit, 20);
  }
});
test("graph reads bounded pages for every source with explicit independent continuation", async () => {
  const f = fixture();
  const first = await api.listKnowledgeGraph({ data: { cursors: {} }, context: f.context });
  assert.equal(f.calls.length, 6);
  assert.ok(first.cursors, "graph must expose source continuation");
  assert.ok(first.cursors.packs);
  assert.ok(first.cursors.projects);
  assert.ok(f.calls.every((call) => call.limit <= 20));
  assert.equal(f.calls.find((call) => call.table === "context_packs").limit, 1);
  const second = await api.listKnowledgeGraph({
    data: { cursors: { packs: first.cursors.packs } },
    context: f.context,
  });
  assert.equal(f.calls.length, 12);
  assert.notEqual(second.cursors.packs, first.cursors.packs);
  assert.equal(second.cursors.projects, first.cursors.projects);
  for (const call of f.calls)
    if (["context_packs", "user_library_items"].includes(call.table))
      assert.equal(call.owner, "actor");
});
