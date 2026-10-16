import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.createSourceFile(
  "memory.tsx",
  readFileSync(process.env.KOVA_MEMORY_SOURCE ?? "src/routes/memory.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let expression;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "merge")
    expression = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule("const merge=" + expression, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(overrides = {}) {
  const items = [1, 2, 3].map((n) => ({
    id: String(n),
    source: "project",
    projectId: "project",
    content: `Memory ${n}`,
  }));
  const records = new Map(items.map((item) => [item.id, item.content]));
  const notices = [];
  let atomicCalls = 0;
  const env = {
    pager: { invalidate() {} },
    editing: null,
    draft: "",
    userKey: "actor",
    currentUserKeyRef: { current: "actor" },
    items,
    selected: items.map((x) => `project:${x.id}`),
    memoryRecordKey: (x) => `${x.source}:${x.id}`,
    mutationPending: { current: false },
    setMutating() {},
    setItems() {},
    setSelected() {},
    setDeleting() {},
    setEditing() {},
    update: async ({ data }) => records.set(data.id, data.content),
    remove: async ({ data }) => {
      if (data.id === "3") throw Error("delete unavailable");
      records.delete(data.id);
    },
    mergeRecords: async () => {
      atomicCalls++;
      throw Error("merge unavailable");
    },
    toast: { error: (value) => notices.push(value), success: (value) => notices.push(value) },
    window: { dispatchEvent() {} },
    Event,
    MEMORY_SOURCES_CHANGED_EVENT: "memory-changed",
    ...overrides,
  };
  const run = new Function(...Object.keys(env), compiled + ";return merge;")(...Object.values(env));
  return {
    records,
    run,
    notices,
    get atomicCalls() {
      return atomicCalls;
    },
  };
}
test("memory merge failure cannot partially update or delete selected records through separate calls", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(
    [...f.records],
    [
      ["1", "Memory 1"],
      ["2", "Memory 2"],
      ["3", "Memory 3"],
    ],
  );
  assert.equal(f.atomicCalls, 1);
});

test("merge requires save or cancel of an affected active draft before dispatch", async () => {
  let calls = 0;
  const f = fixture({
    editing: "project:1",
    draft: "unsaved text",
    mergeRecords: async () => {
      calls++;
      return { id: "1", content: "merged", removedIds: ["2"] };
    },
  });
  await f.run();
  assert.equal(calls, 0);
  assert.match(f.notices.join(" "), /Save or cancel/);
});
test("merging other rows preserves the open edit and draft", async () => {
  let editing = "project:1";
  const f = fixture({
    editing,
    draft: "unsaved text",
    selected: ["project:2", "project:3"],
    setEditing: (value) => {
      editing = value;
    },
    mergeRecords: async () => ({ id: "2", content: "merged", removedIds: ["3"] }),
  });
  await f.run();
  assert.equal(editing, "project:1");
});
test("late merge acknowledgement after account change cannot close or rewrite the new scope", async () => {
  const scope = { current: "actor" };
  let adopted = 0;
  const f = fixture({
    currentUserKeyRef: scope,
    setItems: () => {
      adopted++;
    },
    setEditing: () => {
      adopted++;
    },
    mergeRecords: async () => {
      scope.current = "other";
      return { id: "1", content: "merged", removedIds: ["2"] };
    },
  });
  await f.run();
  assert.equal(adopted, 0);
});
