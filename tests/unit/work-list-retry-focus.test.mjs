import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";
import { parseWorkRunList } from "../../src/lib/work-response.mjs";

const source = readFileSync("src/routes/work.tsx", "utf8");
const file = ts.createSourceFile(
  "work.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
const visit = (node) => {
  nodes.push(node);
  ts.forEachChild(node, visit);
};
visit(file);
const variable = (name) =>
  nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name)
    .initializer;
const contextGuard = nodes
  .find(
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText(file) === "workListFocusRef.current.context !== workListFocusContext",
  )
  .getText(file);
const cleanup = nodes
  .find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("workListFocusRef.current.generation += 1"),
  )
  .arguments[0].getText(file);
const summaryNode = nodes.find(
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.attributes.properties.some(
      (attr) =>
        ts.isJsxAttribute(attr) &&
        attr.name.getText(file) === "aria-label" &&
        attr.initializer?.text === "Work list status",
    ),
);
function compile(text, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(deps));
}
const all = (tree) =>
  !tree || typeof tree !== "object" ? [] : [tree, ...(tree.children ?? []).flatMap(all)];
function fixture(selected = null) {
  const calls = [],
    pending = [],
    detailPending = [];
  const state = {
    runs: [],
    selected: null,
    detail: null,
    loading: false,
    error: "Work runs could not be loaded.",
    preparedDraft: null,
  };
  const document = { body: {}, activeElement: null };
  const element = (name) => ({
    name,
    isConnected: true,
    hidden: false,
    inert: false,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest() {
      return this.inert ? {} : null;
    },
    focus(options) {
      calls.push(["focus", name, options]);
      document.activeElement = this;
    },
  });
  const status = element("Work list status"),
    trigger = element("Try again"),
    execution = element("Execution action");
  status.querySelector = (selector) => {
    assert.equal(selector, '[role="alert"] button');
    return !state.loading && !!state.error && !state.detail && !state.preparedDraft
      ? trigger
      : null;
  };
  document.activeElement = trigger;
  const deps = {
    document,
    window: { location: { href: "https://local.invalid/work" } },
    workListStatusRef: { current: status },
    workListFocusRef: { current: { context: "user:owner-a:true:true", generation: 0 } },
    workListFocusContext: "user:owner-a:true:true",
    workListFocusGeneration: 0,
    workListFocusSelection: selected,
    workListFocusUrl: "https://local.invalid/work",
    isLoaded: true,
    runRequestId: { current: 0 },
    detailRequestId: { current: 0 },
    selectedRef: { current: selected },
    parseWorkRunList,
    fetchRuns: () => {
      calls.push(["request"]);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    fetchDetail: ({ data: { id } }) => {
      calls.push(["detail", id]);
      const request = deferred();
      detailPending.push(request);
      return request.promise;
    },
    setRuns: (value) => {
      state.runs = value;
    },
    setSelected: (value) => {
      state.selected = value;
    },
    setDetail: (value) => {
      state.detail = value;
    },
    setError: (value) => {
      state.error = value;
    },
    setLoading: (value) => {
      calls.push(["loading", value]);
      state.loading = value;
    },
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter(Boolean),
      }),
    },
    ErrorState: "ErrorState",
    EmptyState: "EmptyState",
    Loader2: "Loader2",
    Activity: "Activity",
  };
  deps.loadDetail = compile(`return (${variable("loadDetail").arguments[0].getText(file)});`, deps);
  deps.loadRuns = compile(`return (${variable("loadRuns").arguments[0].getText(file)});`, deps);
  deps.retryWorkList = compile(`return (${variable("retryWorkList").getText(file)});`, deps);
  const unmount = compile(`return (${cleanup});`, deps)();
  return {
    deps,
    calls,
    state,
    status,
    trigger,
    execution,
    document,
    pending,
    detailPending,
    unmount,
    retry: deps.retryWorkList,
    context(next) {
      compile(contextGuard, { ...deps, workListFocusContext: next });
    },
    render: () => compile(`return (${summaryNode.getText(file)});`, { ...deps, ...state }),
  };
}

test("the lower Work list has a stable named, focusable region across error, loading and empty results", () => {
  const f = fixture();
  const unavailable = f.render();
  assert.equal(all(unavailable).find(({ type }) => type === "ErrorState").props.onRetry, f.retry);
  f.state.loading = true;
  const loading = f.render();
  assert.equal(loading.props["aria-busy"], true);
  assert.equal(
    all(loading).some(({ type }) => type === "ErrorState"),
    false,
  );
  assert.equal(
    all(loading).some(({ props }) => props.role === "status"),
    true,
  );
  f.state.loading = false;
  f.state.error = null;
  const empty = f.render();
  assert.equal(
    all(empty).some(({ type }) => type === "EmptyState"),
    true,
  );
  for (const view of [unavailable, loading, empty]) {
    assert.equal(view.type, "section");
    assert.equal(view.props.ref, f.deps.workListStatusRef);
    assert.equal(view.props.role, "region");
    assert.equal(view.props["aria-label"], "Work list status");
    assert.equal(view.props.tabIndex, -1);
  }
});

test("Try again transfers focus before Loading removes its button", async () => {
  const f = fixture();
  f.retry();
  assert.deepEqual(f.calls.slice(0, 3), [
    ["focus", "Work list status", { preventScroll: true }],
    ["loading", true],
    ["request"],
  ]);
  assert.equal(f.document.activeElement, f.status);
  assert.equal(
    all(f.render()).some(({ type }) => type === "ErrorState"),
    false,
  );
  f.pending[0].reject(new Error("Synthetic unavailable"));
  await settle();
  assert.equal(f.state.loading, false);
  assert.equal(f.document.activeElement, f.status);
  assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
});

for (const success of [true, false]) {
  test(`later execution-panel interaction keeps focus when list retry ${success ? "succeeds" : "fails"}`, async () => {
    const f = fixture();
    f.retry();
    f.document.activeElement = f.execution;
    if (success) f.pending[0].resolve([]);
    else f.pending[0].reject(new Error("Synthetic unavailable"));
    await settle();
    assert.equal(f.document.activeElement, f.execution);
    assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
  });
}

test("ordinary list reads do not move focus from the independent execution panel", async () => {
  const f = fixture();
  f.document.activeElement = f.execution;
  const read = f.deps.loadRuns();
  f.pending[0].resolve([]);
  await read;
  assert.equal(f.document.activeElement, f.execution);
  assert.equal(
    f.calls.some(([type]) => type === "focus"),
    false,
  );
  assert.match(
    source,
    /<WorkSessionPanel key=\{principal\} ownerId=\{userKey\} prepared=\{preparedDraft\}/,
  );
  assert.equal(summaryNode.getText(file).includes("WorkSessionPanel"), false);
});

for (const [name, change] of [
  ["account replacement", (f) => f.context("user:owner-b:true:true")],
  [
    "account leaves and returns",
    (f) => {
      f.context("user:owner-b:true:true");
      f.context("user:owner-a:true:true");
    },
  ],
  ["unresolved auth", (f) => f.context(":false:false")],
  ["sign-out", (f) => f.context("guest:true:false")],
  [
    "route change",
    (f) => {
      f.deps.window.location.href = "https://local.invalid/library";
    },
  ],
  ["unmount", (f) => f.unmount()],
  [
    "detached status",
    (f) => {
      f.status.isConnected = false;
    },
  ],
  [
    "detached retry",
    (f) => {
      f.trigger.isConnected = false;
    },
  ],
  [
    "hidden status",
    (f) => {
      f.status.hidden = true;
    },
  ],
  [
    "hidden retry",
    (f) => {
      f.trigger.hidden = true;
    },
  ],
  [
    "inert section",
    (f) => {
      f.trigger.inert = true;
    },
  ],
  [
    "missing status",
    (f) => {
      f.deps.workListStatusRef.current = null;
    },
  ],
  [
    "retry already pending",
    (f) => {
      f.state.loading = true;
    },
  ],
  [
    "error already resolved",
    (f) => {
      f.state.error = null;
    },
  ],
  [
    "prepared draft shown",
    (f) => {
      f.state.preparedDraft = {};
    },
  ],
]) {
  test(`stale list Retry cannot focus or start a request after ${name}`, () => {
    const f = fixture();
    change(f);
    f.retry();
    assert.deepEqual(f.calls, []);
  });
}

test("later focus outside the retry is not overridden by an obsolete invocation", async () => {
  const f = fixture();
  f.document.activeElement = f.execution;
  f.retry();
  assert.equal(f.document.activeElement, f.execution);
  assert.equal(
    f.calls.some(([type]) => type === "focus"),
    false,
  );
  f.pending[0].resolve([]);
  await settle();
});

test("explicit pointer retry from body focuses the stable Work list status", async () => {
  const f = fixture();
  f.document.activeElement = f.document.body;
  f.retry();
  assert.equal(f.document.activeElement, f.status);
  f.pending[0].resolve([]);
  await settle();
});

test("selected-detail failure Retry keeps focus on the same stable Work list region", async () => {
  const f = fixture("run-a");
  f.state.selected = "run-a";
  f.state.error = "The selected run could not be loaded.";
  assert.equal(all(f.render()).find(({ type }) => type === "ErrorState").props.onRetry, f.retry);
  f.retry();
  assert.equal(f.document.activeElement, f.status);
  f.pending[0].resolve([
    {
      id: "run-a",
      kind: "team",
      status: "completed",
      attempts: 1,
      maxAttempts: 3,
      projectId: null,
      createdAt: "2026-10-19T00:00:00Z",
      startedAt: null,
      completedAt: null,
      error: null,
      input: {},
    },
  ]);
  await settle();
  assert.deepEqual(
    f.calls.find(([type]) => type === "detail"),
    ["detail", "run-a"],
  );
  f.detailPending[0].reject(new Error("Synthetic selected detail unavailable"));
  await settle();
  assert.equal(f.document.activeElement, f.status);
  assert.equal(f.state.error, "The selected run could not be loaded.");
  assert.equal(f.state.selected, "run-a");
  assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
});

test("a newer selected run invalidates the previous detail-error Retry before rerender", () => {
  const f = fixture("run-a");
  f.deps.selectedRef.current = "run-b";
  f.retry();
  assert.deepEqual(f.calls, []);
  assert.match(variable("workListFocusContext").getText(file), /selected/);
});

test("leaving and returning to a selected run cannot revive an old detail-error Retry", () => {
  const f = fixture("run-a");
  f.context("user:owner-a:true:true:run-b");
  f.context("user:owner-a:true:true:run-a");
  f.retry();
  assert.deepEqual(f.calls, []);
});
