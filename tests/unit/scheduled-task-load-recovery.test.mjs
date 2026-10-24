import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { formatDisplayDateTime } from "../../src/lib/time-format.ts";

const source = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
const parsed = ts.createSourceFile(
  "tasks.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const compile = (code, dependencies) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(dependencies));
let listExpression;
function visit(node) {
  if (
    ts.isJsxExpression(node) &&
    node.expression?.getText(parsed).startsWith("loading && tasks.length === 0 ?")
  )
    listExpression = node.expression.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(listExpression);
const text = (node) =>
  node == null
    ? ""
    : typeof node !== "object"
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join(" ")
        : text(node.children);
function renderList(state = {}) {
  return compile(`return (${listExpression});`, {
    formatDisplayDateTime,
    timeFormat: "system",
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    loading: false,
    tasks: [],
    visibleTasks: [],
    loadError: null,
    executionAvailable: false,
    Calendar: "calendar",
    Clock: "clock",
    Trash2: "trash",
    MoreHorizontal: "more",
    DropdownMenu: "menu",
    DropdownMenuTrigger: "menu-trigger",
    DropdownMenuContent: "menu-content",
    DropdownMenuItem: "menu-item",
    DropdownMenuSeparator: "menu-separator",
    ScheduledTaskLastRun: "last-run",
    runPreviews: {},
    pendingTaskIds: new Set(),
    taskFeedback: {},
    ...state,
  });
}

test("failed task reads never assert that the account is empty", () => {
  assert.equal(renderList({ loadError: "Unavailable" }), null);
  assert.match(text(renderList()), /Nothing scheduled yet.*No historical task records/);
  assert.doesNotMatch(
    text(renderList({ loading: true, loadError: "Unavailable" })),
    /Nothing scheduled|No historical/,
  );
});

test("cached task history remains visible during failed and pending refreshes", () => {
  const tasks = [
    {
      id: "existing",
      title: "Known history",
      status: "completed",
      run_at: "2026-10-17",
      repeat: "none",
    },
  ];
  for (const loading of [false, true]) {
    const result = renderList({ tasks, visibleTasks: tasks, loading, loadError: "Unavailable" });
    assert.match(text(result), /Known history/);
    assert.doesNotMatch(text(result), /Nothing scheduled|No historical/);
  }
});

test("a retry retains its error control until a successful response", () => {
  const load = source.slice(
    source.indexOf("  const loadTasks = useCallback"),
    source.indexOf("\n  useEffect", source.indexOf("  const loadTasks = useCallback")),
  );
  assert.doesNotMatch(
    load.slice(0, load.indexOf("const next = await list")),
    /setLoadError\(null\)/,
  );
  assert.match(load, /setTasks\(next\);\s*setLoadError\(null\)/);
  assert.match(
    source,
    /onClick=\{retryLoadTasks\}\s*aria-disabled=\{loading\}\s*aria-busy=\{loading\}/,
  );
});

function focusFixture() {
  const focused = [],
    frames = [];
  let resolve,
    calls = 0;
  const pending = new Promise((yes) => {
    resolve = yes;
  });
  const target = { isConnected: true };
  const body = {};
  const document = { body, activeElement: target };
  const window = {
    location: { href: "https://local.invalid/scheduled-tasks" },
    requestAnimationFrame: (fn) => frames.push(fn),
  };
  const refresh = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused.push("refresh"),
  };
  const generationRef = { current: 1 },
    principalRef = { current: "owner" };
  const restoreSource = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
    "export function",
    "function",
  );
  const restoreDialogFocus = compile(`${restoreSource}; return restoreDialogFocus;`, { window });
  const start = source.indexOf("  const retryLoadTasks = async");
  const handler = source.slice(start, source.indexOf("\n  useEffect", start));
  const run = compile(`${handler}; return retryLoadTasks;`, {
    loading: false,
    retryPendingRef: { current: null },
    pendingTaskIdsRef: { current: new Set() },
    window,
    document,
    generationRef,
    principalRef,
    principal: "owner",
    refreshButtonRef: { current: refresh },
    restoreDialogFocus,
    loadTasks: () => {
      calls++;
      return pending;
    },
  });
  return {
    target,
    document,
    window,
    generationRef,
    principalRef,
    refresh,
    focused,
    calls: () => calls,
    run: () => run({ currentTarget: target }),
    finish: async () => {
      if (!target.isConnected && document.activeElement === target) document.activeElement = body;
      resolve();
      await pending;
      await Promise.resolve();
      frames.splice(0).forEach((fn) => fn());
    },
  };
}

test("retry blocks duplicate activation and restores removed-trigger focus to Refresh", async () => {
  const f = focusFixture();
  const first = f.run();
  await f.run();
  assert.equal(f.calls(), 1);
  f.target.isConnected = false;
  await f.finish();
  await first;
  assert.deepEqual(f.focused, ["refresh"]);
});

test("retry focus respects failed retries, newer focus, navigation, account and visibility", async () => {
  for (const change of [
    (f) => {
      f.target.isConnected = true;
    },
    (f) => {
      f.document.activeElement = {};
    },
    (f) => {
      f.window.location.href += "/other";
    },
    (f) => {
      f.generationRef.current++;
    },
    (f) => {
      f.principalRef.current = "other";
    },
    (f) => {
      f.refresh.isConnected = false;
    },
  ]) {
    const f = focusFixture();
    const pending = f.run();
    f.target.isConnected = false;
    change(f);
    await f.finish();
    await pending;
    assert.deepEqual(f.focused, []);
  }
});
