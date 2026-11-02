import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { activityHostname } from "../../src/lib/activity-display.mjs";
const source = readFileSync("src/lib/work-execution.server.ts", "utf8");
const ast = ts.createSourceFile("work.ts", source, ts.ScriptTarget.Latest, true);
const functions = ["getWorkExecution", "listWorkProgress"]
  .map((name) =>
    ast.statements
      .find((node) => ts.isFunctionDeclaration(node) && node.name.text === name)
      .getText(ast)
      .replace(/^export /, ""),
  )
  .join("\n");
const compiled = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function fixture() {
  const owner = "owner-a",
    runId = "run-a",
    calls = [];
  const state = { id: runId, ownerId: owner, status: "running" };
  const database = () => ({
    from(table) {
      const filters = {};
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters[k] = v;
          return q;
        },
        gt(k, v) {
          filters[`after-${k}`] = v;
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          assert.equal(n, 100);
          return q;
        },
        abortSignal() {
          return q;
        },
        async maybeSingle() {
          calls.push({ table, filters });
          return {
            data: filters.owner_id === owner && filters.id === runId ? { state } : null,
            error: null,
          };
        },
        then(resolve) {
          calls.push({ table, filters });
          return Promise.resolve({
            data: [
              {
                revision: 2,
                kind: "effect_started",
                detail: {
                  privateInput: "must-stay-private",
                  publicActivity: {
                    activityId: "effect-a",
                    tool: "browser_interact",
                    label: "Opening github.com…",
                    status: "running",
                    hostname: "github.com",
                  },
                },
              },
            ],
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  });
  const api = new Function(
    "database",
    "workUuid",
    "activityHostname",
    "AbortSignal",
    `${compiled};return {listWorkProgress};`,
  )(database, (id) => id, activityHostname, AbortSignal);
  return { api, calls };
}
test("Work progress reads both the run and journal through the requested owner's scope", async () => {
  const f = fixture();
  const page = await f.api.listWorkProgress({ userId: "owner-a" }, "run-a", 1);
  assert.equal(page.cursor, 2);
  assert.equal(page.activities.length, 2);
  assert.equal(page.activities[1].hostname, "github.com");
  assert.doesNotMatch(JSON.stringify(page.activities), /must-stay-private|privateInput/);
  assert.equal(f.calls[1].filters.owner_id, "owner-a");
  assert.equal(f.calls[1].filters.run_id, "run-a");
  assert.equal(f.calls[1].filters["after-revision"], 1);
});
test("another owner cannot read a run's progress and malformed cursors never reach storage", async () => {
  const f = fixture();
  await assert.rejects(f.api.listWorkProgress({ userId: "owner-b" }, "run-a", 0), /not_found/);
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    f.api.listWorkProgress({ userId: "owner-a" }, "run-a", -1),
    /cursor_invalid/,
  );
  assert.equal(f.calls.length, 1);
});
