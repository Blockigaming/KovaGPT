import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const task = {
  id: "task-a",
  title: "Morning summary",
  prompt: "Summarize",
  status: "scheduled",
  revision: 1,
  run_at: "2026-10-08T09:00:00Z",
  repeat: "none",
  timezone: "UTC",
};
function fixture({ signedIn = true } = {}) {
  const hooks = createHookHarness();
  hooks.react.useMemo = (fn, deps) => hooks.react.useCallback(fn, deps)();
  const reads = [],
    writes = [],
    errors = [],
    timers = new Map();
  const auth = { isLoaded: true, isSignedIn: signedIn, user: signedIn ? { id: "owner-a" } : null };
  const document = new EventTarget();
  document.visibilityState = "visible";
  const window = new EventTarget();
  let timerId = 0;
  window.setInterval = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearInterval = (id) => timers.delete(id);
  window.confirm = () => true;
  const server = {
    isScheduledTasksEligible: async () => ({ eligible: true, executionAvailable: true }),
    listScheduledTasks: (args) => {
      const read = deferred();
      reads.push({ ...read, args });
      return read.promise;
    },
    updateScheduledTask: (args) => {
      const write = deferred();
      writes.push({ ...write, args });
      return write.promise;
    },
    deleteScheduledTask: (args) => {
      const write = deferred();
      writes.push({ ...write, args });
      return write.promise;
    },
  };
  const { Route } = loadUiModule(
    "src/routes/scheduled-tasks.tsx",
    {
      react: hooks.react,
      "@tanstack/react-router": {
        createFileRoute: () => (options) => ({ ...options, useSearch: () => ({}) }),
        Link: "Link",
      },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/components/auth/ClerkSafe": { useUser: () => auth, SignInButton: "SignInButton" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/WorkspacePageHeader": { WorkspacePageHeader: "WorkspacePageHeader" },
      "@/lib/core-launch-policy.mjs": { CORE_LAUNCH_ADVANCED_WORKFLOWS: false },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/lib/scheduled-tasks.functions": server,
      "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
      sonner: { toast: { error: (message) => errors.push(message), success() {}, message() {} } },
      "@/components/AutomationBuilder": { AutomationBuilder: "AutomationBuilder" },
      "@/components/ScheduledTaskEditor": { ScheduledTaskEditor: "ScheduledTaskEditor" },
      "@/components/ScheduledTaskCopies": { ScheduledTaskCopies: "ScheduledTaskCopies" },
      "@/components/WorkspaceIntelligence": { RelatedWorkspaceItems: "RelatedWorkspaceItems" },
      "@/lib/principal-browser-storage.mjs": {
        browserStoragePrincipal: (id) => id ?? "guest",
        consumePrincipalHandoff: () => ({ ok: false, reason: "missing" }),
        isPrincipalBrowserStorageClearedEvent: () => true,
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "principal-cleared",
        safeBrowserStorage: () => null,
      },
    },
    { document, window, crypto: { randomUUID }, Error },
  );
  const render = () => hooks.render(Route.component);
  const button = (tree, label) =>
    elements(
      tree,
      (node) =>
        node.type === "button" &&
        (node.props["aria-label"] === label || text(node).trim() === label),
    )[0];
  const tick = () => {
    for (const { callback } of [...timers.values()]) callback();
  };
  async function ready() {
    render();
    await settle();
    render();
    reads[0].resolve([{ ...task }]);
    await settle();
    return render();
  }
  return {
    render,
    ready,
    reads,
    writes,
    errors,
    timers,
    auth,
    document,
    window,
    button,
    tick,
    hooks,
  };
}

test("visible pending tasks refresh persisted results without executing a task, then stop polling", async () => {
  const f = fixture();
  await f.ready();
  assert.equal([...f.timers.values()][0].delay, 15_000);
  f.tick();
  f.tick();
  assert.equal(f.reads.length, 2, "overlapping background reads must be coalesced");
  f.reads[1].resolve([
    {
      ...task,
      status: "completed",
      last_run_at: "2026-10-08T09:00:01Z",
      last_result: "Actual persisted worker result",
    },
  ]);
  await settle();
  const tree = f.render();
  assert.match(text(tree), /Actual persisted worker result/);
  assert.equal(f.timers.size, 0);
  assert.equal(f.writes.length, 0, "refresh must not start, retry, or modify a task");
  f.hooks.unmount();
});

test("hidden pages do not poll; returning to the page refreshes and errors remain visible without repeated toasts", async () => {
  const f = fixture();
  await f.ready();
  f.document.visibilityState = "hidden";
  f.tick();
  f.window.dispatchEvent(new Event("focus"));
  assert.equal(f.reads.length, 1);
  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.reads.length, 2);
  f.reads[1].reject(new Error("Task history temporarily unavailable"));
  await settle();
  assert.match(text(f.render()), /Task history temporarily unavailable/);
  assert.deepEqual(f.errors, []);
  f.hooks.unmount();
  f.window.dispatchEvent(new Event("focus"));
  f.tick();
  assert.equal(f.reads.length, 2, "unmount must remove timers and focus listeners");
});

test("a late read cannot replace a newer manual refresh", async () => {
  const f = fixture();
  const tree = await f.ready();
  f.tick();
  f.button(tree, "Refresh").props.onClick();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve([{ ...task, title: "Newest task list" }]);
  await settle();
  f.reads[1].resolve([{ ...task, title: "Stale task list" }]);
  await settle();
  const visible = text(f.render());
  assert.match(visible, /Newest task list/);
  assert.doesNotMatch(visible, /Stale task list/);
  f.hooks.unmount();
});

test("a pre-delete read cannot resurrect a removed task and polling pauses during the mutation", async () => {
  const f = fixture();
  const tree = await f.ready();
  f.tick();
  f.button(tree, "Delete").props.onClick();
  assert.equal(f.writes.length, 0, "opening the dialog must not delete the task");
  const confirmation = elements(f.render(), (node) => node.type === "ConfirmActionDialog")[0];
  assert.equal(confirmation.props.open, true);
  confirmation.props.onConfirm();
  f.tick();
  assert.equal(f.reads.length, 2);
  f.writes[0].resolve();
  await settle();
  f.reads[1].resolve([{ ...task }]);
  await settle();
  assert.doesNotMatch(text(f.render()), /Morning summary/);
  f.hooks.unmount();
});

test("account changes discard in-flight task results and refresh only the new owner", async () => {
  const f = fixture();
  await f.ready();
  f.tick();
  f.auth.user = { id: "owner-b" };
  assert.doesNotMatch(text(f.render()), /Morning summary/);
  f.reads[1].resolve([{ ...task, title: "Private owner A task" }]);
  await settle();
  f.render();
  assert.equal(f.reads[2].args.data.expectedUserId, "owner-b");
  f.reads[2].resolve([]);
  await settle();
  assert.doesNotMatch(text(f.render()), /Private owner A task|Morning summary/);
  f.hooks.unmount();
});

test("cancelling task deletion keeps the task and sends no mutation", async () => {
  const f = fixture();
  const tree = await f.ready();
  f.button(tree, "Delete").props.onClick();
  const confirmation = elements(f.render(), (node) => node.type === "ConfirmActionDialog")[0];
  assert.equal(confirmation.props.open, true);
  confirmation.props.onOpenChange(false);
  const current = f.render();
  assert.equal(
    elements(current, (node) => node.type === "ConfirmActionDialog")[0].props.open,
    false,
  );
  assert.match(text(current), /Morning summary/);
  assert.equal(f.writes.length, 0);
  f.hooks.unmount();
});

test("the signed-out task action opens the actual sign-in entry", async () => {
  const f = fixture({ signedIn: false });
  f.render();
  await settle();
  const action = elements(f.render(), (node) => node.type === "SignInButton")[0];
  assert.equal(action.props.mode, "modal");
  assert.equal(text(action).trim(), "Log in");
  assert.equal(f.reads.length, 0);
  f.hooks.unmount();
});
