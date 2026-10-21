import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const scheduled = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
const scheduledFile = ts.createSourceFile(
  "scheduled-tasks.tsx",
  scheduled,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const scheduledNodes = [];
function visitScheduled(node) {
  scheduledNodes.push(node);
  ts.forEachChild(node, visitScheduled);
}
visitScheduled(scheduledFile);
function scheduledAttribute(tag, name) {
  const matches = scheduledNodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(scheduledFile) === name &&
      node.parent.parent.tagName.getText(scheduledFile) === tag,
  );
  assert.equal(matches.length, 1, `Expected exactly one ${tag}.${name}`);
  return matches[0].initializer.expression.getText(scheduledFile);
}
const transpile = (source) =>
  ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function compile(source, dependencies, result) {
  return new Function(...Object.keys(dependencies), transpile(source) + `; return ${result};`)(
    ...Object.values(dependencies),
  );
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function billingFixture(kind) {
  const pending = deferred();
  const events = [];
  const scope = { current: { open: true, epoch: 1 } };
  const busy = { current: false };
  let calls = 0;
  const dependencies = {
    open: true,
    loggedIn: true,
    portalLoading: false,
    subscriptionLoading: false,
    portalPendingRef: busy,
    billingPendingRef: busy,
    billingScopeRef: scope,
    billingIsCurrent: (epoch) => scope.current.open && scope.current.epoch === epoch,
    subSummary: { hasBillingAccount: true, billingPortalAvailable: true },
    createPortalSession: () => {
      calls++;
      return pending.promise;
    },
    getSubscriptionSummary: () => {
      calls++;
      return pending.promise;
    },
    getStripeEnvironment: () => "test",
    parseAllowedBillingPortalUrl: (value) =>
      value === "https://billing.stripe.com/test" ? value : null,
    setPortalLoading: (value) => events.push(["portalLoading", value]),
    setSubscriptionLoading: (value) => events.push(["loading", value]),
    setSubscriptionError: (value) => events.push(["error", value]),
    setSubSummary: (value) => events.push(["summary", value]),
    window: { location: { assign: (value) => events.push(["redirect", value]) } },
    toast: {
      error: (value) => events.push(["toast", value]),
      success: (value) => events.push(["toast", value]),
      message: (value) => events.push(["toast", value]),
    },
  };
  const name = kind === "portal" ? "handleManageBilling" : "handleRestore";
  const start = settings.indexOf(`  const ${name} = async`);
  const end = settings.indexOf(
    kind === "portal" ? "\n  useEffect" : "\n  const familyTierUpgrade",
    start,
  );
  const run = compile(settings.slice(start, end), dependencies, name);
  return { run, scope, busy, events, pending, calls: () => calls };
}
for (const kind of ["portal", "restore"]) {
  test(`billing ${kind} blocks repeated clicks before a re-render`, async () => {
    const f = billingFixture(kind);
    const first = f.run();
    await f.run();
    assert.equal(f.calls(), 1);
    f.pending.resolve(
      kind === "portal" ? { url: "https://billing.stripe.com/test" } : { effectiveTier: "plus" },
    );
    await first;
    assert.equal(f.busy.current, false);
    assert.ok(f.events.some(([event]) => event === (kind === "portal" ? "redirect" : "summary")));
  });
  test(`billing ${kind} ignores stale success and leaves the new lifetime untouched`, async () => {
    const f = billingFixture(kind);
    const first = f.run();
    f.scope.current.epoch++;
    f.events.length = 0;
    f.pending.resolve(
      kind === "portal" ? { url: "https://billing.stripe.com/test" } : { effectiveTier: "plus" },
    );
    await first;
    assert.deepEqual(f.events, []);
    assert.equal(f.busy.current, true);
  });
  test(`billing ${kind} suppresses errors after close`, async () => {
    const f = billingFixture(kind);
    const first = f.run();
    f.scope.current.open = false;
    f.events.length = 0;
    f.pending.reject(new Error("synthetic failure"));
    await first;
    assert.deepEqual(f.events, []);
  });
}

function taskFixture() {
  const requests = [],
    events = [],
    frames = [];
  const generationRef = { current: 1 },
    pendingTaskIdsRef = { current: new Set() },
    listRequestRef = { current: 0 },
    principalRef = { current: "owner" },
    actionFocusRef = { current: new Map() };
  let taskFeedback = {},
    deleteTask = null;
  let tasks = [
    { id: "a", title: "First task", revision: 1, status: "scheduled" },
    { id: "b", title: "Second task", revision: 1, status: "failed" },
  ];
  // Lifetime tests need the real action callbacks, not a browser focus simulation.
  const document = { body: {}, addEventListener() {}, removeEventListener() {} };
  document.activeElement = document.body;
  const window = {
    location: { href: "https://local.invalid/scheduled-tasks" },
    requestAnimationFrame: (callback) => frames.push(callback),
  };
  const request = (input) => {
    const pending = deferred();
    requests.push({ ...pending, input });
    return pending.promise;
  };
  const dependencies = {
    dataReady: true,
    dataGeneration: 1,
    generationRef,
    principal: "owner",
    principalRef,
    userKey: "owner",
    mutations: { current: new Map() },
    pendingTaskIdsRef,
    listRequestRef,
    crypto: { randomUUID: () => "mutation" },
    update: request,
    remove: request,
    setPendingTaskIds: (value) => events.push(["pending", value]),
    setLoading: (value) => events.push(["loading", value]),
    setTasks: (fn) => {
      tasks = fn(tasks);
    },
    setTaskFeedback: (fn) => {
      taskFeedback = fn(taskFeedback);
      events.push(["feedback", taskFeedback]);
    },
    setDeleteTask: (value) => {
      deleteTask = value;
      events.push(["delete", value]);
    },
    taskFeedbackRefs: { current: new Map() },
    taskActionButtonsRef: { current: new Map() },
    taskMenuActionsRef: { current: new Set() },
    deleteReturnRef: { current: null },
    deleteFeedbackRef: { current: null },
    actionFocusRef,
    taskActionLabels: compile(
      scheduledNodes
        .find(
          (node) =>
            ts.isVariableDeclaration(node) &&
            node.name.getText(scheduledFile) === "taskActionLabels",
        )
        .parent.parent.getText(scheduledFile),
      {},
      "taskActionLabels",
    ),
    document,
    window,
    restoreDialogFocus: compile(
      readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace("export function", "function"),
      { window },
      "restoreDialogFocus",
    ),
    toast: { error: (message) => events.push(message), success: (message) => events.push(message) },
  };
  const body = scheduled.slice(
    scheduled.indexOf("  const identity ="),
    scheduled.indexOf("\n  const deleteFocusOrigin =", scheduled.indexOf("  const identity =")),
  );
  const actions = compile(body, dependencies, "({togglePause, openDelete, runTaskAction, retry})");
  const deleteState = () => ({
    deleteTask,
    deletePending: !!deleteTask && pendingTaskIdsRef.current.has(deleteTask.id),
    deleteFeedback: deleteTask ? taskFeedback[deleteTask.id] : undefined,
  });
  const deleteHandler = () => {
    let completion;
    const onClick = compile(
      `const onClick = ${scheduledAttribute("AlertDialogAction", "onClick")};`,
      {
        ...deleteState(),
        runTaskAction: (...args) => (completion = actions.runTaskAction(...args)),
      },
      "onClick",
    );
    return () => {
      completion = undefined;
      let prevented = false;
      onClick({ currentTarget: null, preventDefault: () => (prevented = true) });
      assert.equal(prevented, true, "Confirmation stays open while the server request settles");
      return completion;
    };
  };
  return {
    ...actions,
    requests,
    events,
    generationRef,
    principalRef,
    pendingTaskIdsRef,
    listRequestRef,
    tasks: () => tasks,
    feedback: () => taskFeedback,
    deleteTask: () => deleteTask,
    deleteHandler,
    confirmDelete: () => deleteHandler()(),
    closeDelete: () =>
      compile(
        `const onOpenChange = ${scheduledAttribute("AlertDialog", "onOpenChange")};`,
        { ...deleteState(), setDeleteTask: dependencies.setDeleteTask },
        "onOpenChange",
      )(false),
    flushFrames() {
      while (frames.length) frames.shift()();
      assert.equal(actionFocusRef.current.size, 0);
    },
  };
}
test("task actions serialize each row while allowing independent rows", async () => {
  const f = taskFixture();
  const a = f.tasks()[0],
    b = f.tasks()[1];
  const first = f.togglePause(a);
  await f.togglePause(a);
  f.openDelete(a);
  assert.equal(f.deleteTask(), null, "A pending row cannot open a conflicting delete");
  await f.confirmDelete();
  const second = f.retry(b);
  assert.equal(f.requests.length, 2);
  assert.equal(f.listRequestRef.current, 2);
  f.requests[0].resolve({ ...a, revision: 2, status: "paused" });
  f.requests[1].resolve({ ...b, revision: 2, status: "scheduled" });
  await Promise.all([first, second]);
  f.flushFrames();
  assert.equal(f.pendingTaskIdsRef.current.size, 0);
  assert.equal(f.tasks()[0].status, "paused");
  assert.equal(f.feedback().a.state, "success");
  assert.equal(f.feedback().b.state, "success");
});
test("failed task actions preserve the row and release the control for retry", async () => {
  const f = taskFixture();
  const task = f.tasks()[0];
  f.openDelete(task);
  assert.equal(f.requests.length, 0, "Opening confirmation must not delete the row");
  const confirm = f.deleteHandler();
  const first = confirm();
  await confirm();
  assert.equal(f.requests.length, 1, "Even a repeated pre-render confirmation is serialized");
  f.closeDelete();
  assert.equal(f.deleteTask(), task, "A pending delete cannot be dismissed");
  f.requests[0].reject(new Error("synthetic failure"));
  await first;
  f.flushFrames();
  assert.equal(f.tasks().length, 2);
  assert.equal(f.pendingTaskIdsRef.current.size, 0);
  assert.equal(f.feedback().a.state, "error");
  assert.match(f.feedback().a.message, /Couldn’t confirm delete.*synthetic failure/);
  assert.equal(f.deleteTask(), task, "A failed delete retains its named confirmation");
  const retry = f.confirmDelete();
  assert.deepEqual(
    f.requests[1].input,
    f.requests[0].input,
    "Retry retains the exact delete request",
  );
  f.requests[1].resolve({ ok: true });
  await retry;
  f.flushFrames();
  assert.equal(f.tasks().length, 1);
  assert.equal(f.deleteTask(), null);
  assert.equal(f.feedback().a.state, "success");
});
test("task completion after unmount cannot change rows, notify, or unlock a new lifetime", async () => {
  const f = taskFixture();
  const task = f.tasks()[1];
  const first = f.retry(task);
  f.generationRef.current++;
  const feedback = f.feedback();
  f.events.length = 0;
  f.requests[0].resolve({ ...task, status: "scheduled" });
  await first;
  f.flushFrames();
  assert.equal(f.tasks()[1].status, "failed");
  assert.deepEqual(f.events, []);
  assert.equal(
    f.feedback(),
    feedback,
    "Late completion cannot replace the new lifetime's feedback",
  );
  assert.equal(f.pendingTaskIdsRef.current.has(task.id), true);
});

test("task deletion confirmation can be canceled without issuing a request", () => {
  const f = taskFixture();
  f.openDelete(f.tasks()[0]);
  assert.equal(f.deleteTask(), f.tasks()[0]);
  f.closeDelete();
  assert.equal(f.deleteTask(), null);
  assert.equal(f.requests.length, 0);
  assert.equal(f.tasks().length, 2);
});

test("task failure after an account change cannot publish feedback or release another account's row", async () => {
  const f = taskFixture();
  const task = f.tasks()[0];
  const first = f.togglePause(task);
  f.principalRef.current = "different-owner";
  const feedback = f.feedback();
  f.events.length = 0;
  f.requests[0].reject(new Error("late failure"));
  await first;
  f.flushFrames();
  assert.equal(f.tasks()[0].status, "scheduled");
  assert.deepEqual(f.events, []);
  assert.equal(f.feedback(), feedback);
  assert.equal(f.pendingTaskIdsRef.current.has(task.id), true);
});

function taskLoadFixture() {
  const requests = [],
    events = [];
  const pendingTaskIdsRef = { current: new Set() },
    listRequestRef = { current: 0 };
  let tasks = [];
  const dependencies = {
    dataReady: true,
    dataGeneration: 1,
    generationRef: { current: 1 },
    principal: "owner",
    principalRef: { current: "owner" },
    userKey: "owner",
    accessState: "eligible",
    pendingTaskIdsRef,
    listRequestRef,
    taskListLoaded: { current: false },
    useCallback: (fn) => fn,
    list: () => {
      const pending = deferred();
      requests.push(pending);
      return pending.promise;
    },
    setTasks: (value) => {
      tasks = value;
    },
    setLoading: (value) => events.push(["loading", value]),
    setLoadError: (value) => events.push(["error", value]),
    setRunRefreshVersion: (update) => events.push(["runRefresh", update(0)]),
    toast: { error: (value) => events.push(["toast", value]) },
  };
  const start = scheduled.indexOf("  const loadTasks = useCallback");
  const body = scheduled.slice(start, scheduled.indexOf("\n  useEffect", start));
  return {
    load: compile(body, dependencies, "loadTasks"),
    requests,
    events,
    pendingTaskIdsRef,
    listRequestRef,
    tasks: () => tasks,
  };
}
test("scheduled list keeps the latest read rather than an out-of-order response", async () => {
  const f = taskLoadFixture();
  const first = f.load(),
    second = f.load();
  f.requests[1].resolve([{ id: "current", revision: 2 }]);
  await second;
  f.requests[0].resolve([{ id: "stale", revision: 1 }]);
  await first;
  assert.deepEqual(f.tasks(), [{ id: "current", revision: 2 }]);
  assert.deepEqual(f.events, [
    ["loading", true],
    ["loading", true],
    ["error", null],
    ["runRefresh", 1],
    ["loading", false],
  ]);
});
test("scheduled reads cannot resurrect a row while a mutation is pending", async () => {
  const f = taskLoadFixture();
  const first = f.load();
  f.pendingTaskIdsRef.current.add("task");
  f.listRequestRef.current++;
  await f.load();
  assert.equal(f.requests.length, 1);
  f.events.length = 0;
  f.requests[0].resolve([{ id: "task", revision: 1 }]);
  await first;
  assert.deepEqual(f.tasks(), []);
  assert.deepEqual(f.events, []);
});
