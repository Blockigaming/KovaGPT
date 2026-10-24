import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { calculateCriticalPath, dagLayout } from "../../src/lib/work-graph.mjs";

const source = readFileSync("src/routes/work.tsx", "utf8");
const file = ts.createSourceFile(
  "work.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children
      .flat(Infinity)
      .filter((child) => child !== null && child !== undefined && typeof child !== "boolean"),
  }),
};
const text = (tree) =>
  typeof tree !== "object" ? String(tree ?? "") : (tree?.children ?? []).map(text).join(" ");
const all = (tree) =>
  !tree || typeof tree !== "object" ? [] : [tree, ...(tree.children ?? []).flatMap(all)];
const deps = {
  React,
  terminal: new Set(["completed", "failed", "cancelled"]),
  useMemo: (fn) => fn(),
  useState: (initial) => [initial, () => {}],
  calculateCriticalPath,
  dagLayout,
  Circle: "Circle",
  X: "X",
  statusTone: {},
};
function component(name) {
  const node = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(`${node.getText(file)}\nreturn ${name};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(deps));
}
const Graph = component("DependencyGraph"),
  Timeline = component("Timeline");
const detail = (status, events = [], tasks = []) => ({ run: { status }, tasks, edges: [], events });

for (const status of ["completed", "failed", "cancelled"]) {
  test(`${status} Graph and Timeline explicitly explain that no events were recorded`, () => {
    for (const render of [Graph, Timeline]) {
      const tree = render({ detail: detail(status) });
      const empty = all(tree).find(({ props }) => props.role === "status");
      assert.ok(empty);
      assert.match(text(empty), new RegExp(`This run is ${status}\\.`));
      assert.match(text(empty), /[Nn]o .*events.*were recorded\./);
      assert.doesNotMatch(text(tree), /Waiting/);
    }
  });
}

for (const status of ["queued", "running", "leased", "paused", "approval_required", "retrying"]) {
  test(`${status} empty histories retain the existing pending wording`, () => {
    for (const render of [Graph, Timeline]) {
      const tree = render({ detail: detail(status) });
      assert.match(text(tree), /Waiting for the first persisted specialist event\./);
      assert.doesNotMatch(text(tree), /This run is completed|No events were recorded/);
    }
  });
}

test("a terminal graph with non-specialist events does not claim no events exist", () => {
  const event = {
    id: "event-a",
    type: "run_completed",
    payload: {},
    createdAt: "2026-10-19T00:00:00Z",
  };
  const tree = Graph({ detail: detail("completed", [event]) });
  assert.match(text(tree), /This run is completed\. No specialist tasks were recorded\./);
  assert.doesNotMatch(text(tree), /No events|or events/);
});

test("recorded Timeline events render unchanged without an empty placeholder", () => {
  const event = {
    id: "event-a",
    type: "run_completed",
    payload: { summary: "Synthetic complete" },
    createdAt: "2026-10-19T00:00:00Z",
  };
  const tree = Timeline({ detail: detail("completed", [event]) });
  assert.match(text(tree), /run completed/);
  assert.match(text(tree), /Synthetic complete/);
  assert.equal(all(tree).filter(({ type }) => type === "li").length, 1);
  assert.equal(
    all(tree).some(({ props }) => props.role === "status"),
    false,
  );
});

test("terminal specialist tasks remain visible even when they have no recorded actions", () => {
  const tree = Graph({
    detail: detail(
      "completed",
      [],
      [{ id: "task-a", role: "Research", status: "completed", startedAt: null, completedAt: null }],
    ),
  });
  assert.match(text(tree), /Research/);
  assert.match(text(tree), /0\s+recorded action/);
  assert.doesNotMatch(text(tree), /Waiting|No specialist tasks/);
});
