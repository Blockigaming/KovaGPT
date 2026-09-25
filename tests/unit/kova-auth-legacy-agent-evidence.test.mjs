import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/agents/team.server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const owner = "10000000-0000-4000-8000-000000000001";
const run = "20000000-0000-4000-8000-000000000002";

function fixture(authProvider) {
  const calls = [];
  const exports = {};
  const rows = {
    agent_runs: [{ id: run }],
    agent_run_tasks: [],
    agent_run_events: [
      {
        run_id: run,
        kind: "screenshot",
        safe_payload: { storagePath: `${owner}/screenshot.png` },
        evidence_sha256: "a".repeat(64),
      },
    ],
  };
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(rows, table));
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve) => resolve({ data: rows[table], error: null }),
      };
      return query;
    },
    storage: {
      from: (bucket) => ({
        async createSignedUrl(path) {
          calls.push([bucket, path]);
          return { data: { signedUrl: "https://storage.test/transferable" } };
        },
      }),
    },
  };
  vm.runInNewContext(source, {
    exports,
    Error,
    require: (name) => {
      assert.equal(name, "@/lib/lockdown-policy.mjs");
      return { assertLockdownAllows: async () => {} };
    },
  });
  return {
    getAgentTeamRuns: exports.getAgentTeamRuns,
    calls,
    caller: { authProvider, userId: owner, supabaseAdmin: client },
  };
}

test("retired agent-team screenshots do not expose signed Storage capabilities under owned authority", async () => {
  const owned = fixture("kova");
  const result = await owned.getAgentTeamRuns(owned.caller);
  assert.deepEqual(owned.calls, []);
  assert.equal(result.events[0].safe_payload.screenshotUrl, null);
  assert.equal(result.events[0].safe_payload.storagePath, undefined);

  const hosted = fixture("supabase");
  const legacy = await hosted.getAgentTeamRuns(hosted.caller);
  assert.equal(hosted.calls.length, 1);
  assert.equal(legacy.events[0].safe_payload.screenshotUrl, "https://storage.test/transferable");
});
