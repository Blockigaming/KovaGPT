import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { formatDisplayDateTime } from "../../src/lib/time-format.ts";
import { taskRunStatusLabel } from "../../src/lib/scheduled-task-run-labels.ts";

const read = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
const source = read("lib/scheduled-task-run-page.ts");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { createTaskRunPageReader, createTaskRunReadBudget, TASK_RUN_PAGE_SIZE } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const task = (id, revision = 1) => ({ id, revision, updated_at: "2026-10-19", last_run_at: null });
const tasks = (prefix, count = 10) =>
  Array.from({ length: count }, (_, i) => task(`${prefix}${i}`));
const settle = () => new Promise(setImmediate);
const run = (status = "complete", summary = "Done", time = "2026-10-19T00:00:00Z") => ({
  status,
  result_summary: summary,
  scheduled_for: time,
});

test("visible-page reads cap at 10 and at most two are in flight", async () => {
  const starts = [],
    pending = [];
  const snapshots = [];
  const reader = createTaskRunPageReader(
    (owner, id) => {
      starts.push([owner, id]);
      return new Promise((resolve) => pending.push(resolve));
    },
    () => null,
  );
  reader.loadPage("owner-a", tasks("a", 1000), 0, (state) => snapshots.push(state));
  await settle();
  assert.equal(starts.length, 2);
  assert.equal(Object.keys(snapshots[0]).length, TASK_RUN_PAGE_SIZE);
  for (let batch = 0; batch < 5; batch++) {
    assert.equal(pending.length, 2);
    pending.splice(0).forEach((resolve) => resolve([]));
    await settle();
  }
  assert.equal(starts.length, 10);
  assert.ok(starts.every(([owner]) => owner === "owner-a"));
  assert.ok(Object.values(snapshots.at(-1)).every((state) => state.kind === "empty"));
});

test("page departure drops queued reads and late reads do not repopulate departed rows", async () => {
  const starts = [],
    pending = [];
  let oldUpdates = 0,
    current = {};
  const reader = createTaskRunPageReader(
    (owner, id) => {
      starts.push(id);
      return new Promise((resolve) => pending.push(resolve));
    },
    () => null,
  );
  const cancel = reader.loadPage("owner", tasks("old"), 0, () => oldUpdates++);
  await settle();
  cancel();
  const before = oldUpdates;
  reader.loadPage("owner", tasks("new", 2), 0, (state) => (current = state));
  await settle();
  assert.deepEqual(starts, ["old0", "old1"]);
  pending.splice(0).forEach((resolve) => resolve([run()]));
  await settle();
  assert.deepEqual(starts, ["old0", "old1", "new0", "new1"]);
  pending.splice(0).forEach((resolve) => resolve([]));
  await settle();
  assert.equal(oldUpdates, before);
  assert.deepEqual(Object.keys(current), ["new0", "new1"]);
  assert.equal(current.new0.kind, "empty");
});

test("same-owner cache deduplicates pending reads and invalidates revision, refresh and age", async () => {
  let calls = 0,
    time = 1_000,
    finish;
  const reader = createTaskRunPageReader(
    () => {
      calls++;
      return calls === 1 ? new Promise((resolve) => (finish = resolve)) : Promise.resolve([run()]);
    },
    () => null,
    () => time,
  );
  let state;
  const load = (revision = 1, version = 0) =>
    reader.loadPage("owner", [task("a", revision)], version, (next) => (state = next));
  load();
  await settle();
  load();
  await settle();
  assert.equal(calls, 1);
  finish([run()]);
  await settle();
  assert.equal(state.a.kind, "run");
  load();
  await settle();
  assert.equal(calls, 1);
  load(2);
  await settle();
  assert.equal(calls, 2);
  load(2, 1);
  await settle();
  assert.equal(calls, 3);
  time += 60_000;
  load(2, 1);
  await settle();
  assert.equal(calls, 4);
});

test("owner switches and account resets discard cached and late responses", async () => {
  for (const reset of [false, true]) {
    const pending = [],
      calls = [];
    let state;
    const reader = createTaskRunPageReader(
      (owner, id) => {
        calls.push([owner, id]);
        return new Promise((resolve) => pending.push(resolve));
      },
      () => null,
    );
    reader.loadPage("alice", [task("shared-id")], 0, () => {});
    await settle();
    if (reset) reader.reset();
    const owner = reset ? "alice" : "bob";
    reader.loadPage(owner, [task("shared-id")], 0, (next) => (state = next));
    await settle();
    pending[0]([run("failed", "Alice's old data")]);
    await settle();
    assert.equal(state["shared-id"].kind, "loading");
    pending[1]([]);
    await settle();
    assert.equal(state["shared-id"].kind, "empty");
    assert.deepEqual(calls, [
      ["alice", "shared-id"],
      [owner, "shared-id"],
    ]);
  }
});

test("preview status comes only from first returned history row, even when prose conflicts", async () => {
  let state;
  const reader = createTaskRunPageReader(
    async () => [
      run("failed", "Completed successfully", "2020-01-01T00:00:00Z"),
      run("complete", "Old record", "2030-01-01T00:00:00Z"),
    ],
    () => null,
  );
  reader.loadPage(
    "owner",
    [{ ...task("a"), status: "completed", last_result: "Success" }],
    0,
    (next) => (state = next),
  );
  await settle();
  assert.equal(state.a.status, "failed");
  assert.equal(state.a.summary, "Completed successfully");
  assert.equal(state.a.at, "2020-01-01T00:00:00Z", "preserve endpoint ordering");
});

test("transport errors and malformed responses remain unavailable rather than empty", async () => {
  for (const fetch of [
    () => {
      throw new Error("offline");
    },
    async () => null,
    async () => [null],
  ]) {
    let state;
    const reader = createTaskRunPageReader(fetch, () => null);
    reader.loadPage("owner", [task("a")], 0, (next) => (state = next));
    await settle();
    assert.equal(state.a.kind, "unavailable");
  }
});

test("rapid paging and refreshes stop at 20 attempts per rolling minute with a truthful retry time", async () => {
  let time = 10_000,
    calls = 0,
    state;
  const budget = createTaskRunReadBudget(() => time);
  const reader = createTaskRunPageReader(
    async () => {
      calls++;
      return [];
    },
    budget,
    () => time,
  );
  for (let page = 0; page < 5; page++) {
    reader.loadPage("owner", tasks(`p${page}-`), page, (next) => (state = next));
    await settle();
  }
  assert.equal(calls, 20);
  assert.ok(
    Object.values(state).every((value) => value.kind === "deferred" && value.retryAt === 70_000),
  );
  time = 69_999;
  reader.loadPage("owner", [task("after")], 6, (next) => (state = next));
  await settle();
  assert.equal(calls, 20);
  time = 70_000;
  reader.loadPage("owner", [task("after")], 7, (next) => (state = next));
  await settle();
  assert.equal(calls, 21);
  assert.equal(state.after.kind, "empty");
});

test("cache evicts old entries beyond 100 task identities", async () => {
  let calls = 0;
  const reader = createTaskRunPageReader(
    async () => {
      calls++;
      return [];
    },
    () => null,
  );
  for (let page = 0; page < 11; page++) {
    reader.loadPage("owner", tasks(`p${page}-`), 0, () => {});
    await settle();
  }
  assert.equal(calls, 110);
  reader.loadPage("owner", [task("p10-0")], 0, () => {});
  await settle();
  assert.equal(calls, 110);
  reader.loadPage("owner", [task("p0-0")], 0, () => {});
  await settle();
  assert.equal(calls, 111);
});

test("route bounds the displayed page without changing stored search or filter, and keeps page controls focusable", () => {
  const route = read("routes/scheduled-tasks.tsx");
  assert.match(
    route,
    /filteredTasks\.slice\(pageIndex \* TASK_RUN_PAGE_SIZE, \(pageIndex \+ 1\) \* TASK_RUN_PAGE_SIZE\)/,
  );
  assert.match(
    route,
    /pageScope = JSON\.stringify\(\[principal, lifecycleVersion, filter, query\]\)/,
  );
  const nav = route.slice(route.indexOf("<nav\n"), route.indexOf("</nav>") + 6);
  assert.match(nav, /aria-label="Scheduled task pages"/);
  assert.equal((nav.match(/aria-disabled=/g) || []).length, 2);
  assert.doesNotMatch(nav, /\sdisabled=|setQuery|setFilter/);
  assert.match(
    route,
    /<ScheduledTaskLastRun\s+preview=\{runPreviews\[t\.id\]\}\s+timeFormat=\{timeFormat\}/,
  );
  assert.doesNotMatch(route, /!t\.last_run_at/);
  const hook = read("hooks/use-scheduled-task-run-previews.ts");
  assert.match(hook, /expectedUserId: owner, taskId/);
  assert.match(hook, /snapshot\?\.key === key \? snapshot\.states : EMPTY_PREVIEWS/);
  assert.match(hook, /return \(\) => reader\.reset\(\)/);
});

test("run presentation distinguishes loading, no run, read error and budget waiting without outcome inference", () => {
  const component = read("components/ScheduledTaskLastRun.tsx");
  assert.match(component, /Last run: loading status/);
  assert.match(component, /Last run: no run recorded/);
  assert.match(component, /Last run status unavailable/);
  assert.match(component, /Last run: not checked yet\. Refresh after/);
  assert.match(component, /taskRunStatusLabel\(preview\.status\)/);
  assert.match(component, /formatDisplayDateTime\(preview\.at, timeFormat\)/);
  assert.doesNotMatch(component, /task\.status|last_result/);
});

test("rendered last-run labels preserve legacy saved history without inventing an outcome", () => {
  const source = read("components/ScheduledTaskLastRun.tsx")
    .replace(/^import .*;\n/gm, "")
    .replace("export function", "function");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const Component = new Function(
    "React",
    "formatDisplayDateTime",
    "taskRunStatusLabel",
    `${javascript}; return ScheduledTaskLastRun;`,
  )(
    { createElement: (type, props, ...children) => ({ type, props, children }) },
    formatDisplayDateTime,
    taskRunStatusLabel,
  );
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object"
        ? text(node.children)
        : typeof node === "string"
          ? node
          : "";
  const props = {
    timeFormat: "24-hour",
    lastRunAt: "2026-10-19T13:04:00Z",
    lastResult: "Historical saved result",
  };
  const missingHistory = text(Component({ ...props, preview: { kind: "empty" } }));
  assert.match(missingHistory, /status unavailable in run history/);
  assert.match(missingHistory, /Saved task history.*Historical saved result/);
  assert.ok(missingHistory.includes(formatDisplayDateTime(props.lastRunAt, props.timeFormat)));
  assert.doesNotMatch(missingHistory, /no run recorded/);
  assert.match(
    text(Component({ timeFormat: "system", preview: { kind: "empty" } })),
    /no run recorded/,
  );
  assert.match(text(Component(props)), /loading status.*Historical saved result/);
  const actual = text(
    Component({
      ...props,
      preview: {
        kind: "run",
        status: "failed",
        at: props.lastRunAt,
        summary: "Completed successfully",
      },
    }),
  );
  assert.match(actual, /Last run:.*Failed.*Completed successfully/);
  assert.ok(actual.includes(formatDisplayDateTime(props.lastRunAt, props.timeFormat)));
  assert.doesNotMatch(actual, /Historical saved result/);
});

test("new reader instances share the preview-read budget instead of resetting it on remount", async () => {
  let calls = 0,
    finalState;
  for (let mount = 0; mount < 3; mount++) {
    const reader = createTaskRunPageReader(async () => {
      calls++;
      return [];
    });
    reader.loadPage("owner", tasks(`mount${mount}-`), 0, (state) => (finalState = state));
    await settle();
    reader.reset();
  }
  assert.equal(calls, 20);
  assert.ok(Object.values(finalState).every((state) => state.kind === "deferred"));
});
