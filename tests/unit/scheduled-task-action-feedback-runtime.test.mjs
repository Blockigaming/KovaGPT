import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

// Source-executed hook/handler tests only. These do not launch a browser or prove Radix behavior.
const normalized = (value) =>
  text(value).replace(/\s+/g, " ").replace(/“ /g, "“").replace(/ ”/g, "”").trim();
const primitives = (names) => Object.fromEntries(names.split(" ").map((name) => [name, name]));
const task = {
  id: "task-one",
  title: "Morning briefing",
  prompt: "Saved prompt",
  revision: 4,
  status: "scheduled",
  repeat: "daily",
  timezone: "UTC",
  run_at: "2027-01-01T09:00:00Z",
  next_run_at: "2027-01-01T09:00:00Z",
  trigger_mode: "time",
  context_refs: [],
  event_triggers: [],
};
function environment() {
  const hooks = createHookHarness(),
    effects = [],
    frames = [],
    focusEvents = [],
    scrolls = [];
  const effect = hooks.react.useEffect;
  hooks.react.useEffect = (fn, deps) =>
    effect(() => {
      let cleanup;
      effects.push(() => {
        cleanup = fn();
      });
      return () => cleanup?.();
    }, deps);
  hooks.react.useMemo = (fn, deps) => hooks.react.useCallback(fn, deps)();
  const listeners = new Map();
  const emit = (name, event) => {
    for (const listener of listeners.get(name) ?? []) listener(event);
  };
  const document = {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
  };
  class Node {
    constructor(label) {
      this.label = label;
      this.isConnected = true;
      this.ownerDocument = document;
      this.scrollTop = 0;
    }
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    matches() {
      return this.disabled ?? false;
    }
    closest() {
      return null;
    }
    contains(value) {
      return value === this || (!!value?.parent && this.contains(value.parent));
    }
    focus() {
      document.activeElement = this;
      focusEvents.push(this.label);
      emit("focusin", { target: this });
    }
    scrollIntoView() {
      scrolls.push(this.label);
    }
  }
  document.body = new Node("body");
  document.activeElement = document.body;
  const window = {
    location: { href: "https://fixture.test/scheduled-tasks" },
    requestAnimationFrame: (callback) => frames.push(callback),
    addEventListener: document.addEventListener,
    removeEventListener: document.removeEventListener,
  };
  const restore = loadUiModule("src/lib/dialog-return-focus.ts", {}, { window });
  const nodes = new Map();
  let tree,
    component,
    props = {},
    attached = new Set();
  function render() {
    tree = hooks.render(component, props);
    const next = new Set();
    const walk = (value, parent = null) => {
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, parent));
        return;
      }
      if (!value?.props || (value.type === "AlertDialog" && !value.props.open)) return;
      const p = value.props,
        label =
          p["aria-label"] ??
          p.id ??
          (value.type === "DialogContent" ? "schedule-dialog" : null) ??
          (value.type === "form" ? "schedule-form" : null) ??
          (value.type === "button" && p.type === "submit" ? "save-submit" : null) ??
          (typeof value.type === "string" ? value.type + ":" + text(value).trim() : null);
      let node = parent;
      if (label) {
        if (!nodes.has(label)) nodes.set(label, new Node(label));
        node = nodes.get(label);
        node.parent = parent;
        node.isConnected = true;
        node.disabled = !!p.disabled;
        next.add(node);
        value.node = node;
        node.ref = p.ref;
        if (typeof p.ref === "function") p.ref(node);
        else if (p.ref) p.ref.current = node;
      }
      walk(p.children, node);
    };
    walk(tree);
    for (const node of attached)
      if (!next.has(node)) {
        node.isConnected = false;
        if (typeof node.ref === "function") node.ref(null);
        else if (node.ref?.current === node) node.ref.current = null;
        if (document.activeElement === node) document.activeElement = document.body;
      }
    attached = next;
    while (effects.length) effects.shift()();
    return tree;
  }
  function framesNow() {
    while (frames.length) frames.shift()();
  }
  const find = (type, label) =>
    elements(
      tree,
      (item) => item.type === type && (label === undefined || normalized(item) === label),
    )[0];
  const byLabel = (label) => elements(tree, (item) => item.props["aria-label"] === label)[0];
  function click(type, label, eventName = "onClick") {
    const element = find(type, label);
    assert.ok(element, `Missing ${type} ${label}`);
    element.node?.focus();
    const result = element.props[eventName]({
      currentTarget: element.node,
      target: element.node,
      preventDefault() {},
    });
    render();
    framesNow();
    return result;
  }
  return {
    hooks,
    document,
    window,
    Node,
    restore,
    nodes,
    emit,
    focusEvents,
    scrolls,
    find,
    byLabel,
    click,
    render,
    framesNow,
    start(nextComponent, nextProps = {}) {
      component = nextComponent;
      props = nextProps;
      render();
      return this;
    },
    tree: () => tree,
    async flush() {
      await settle();
      render();
      framesNow();
    },
    globals: {
      window,
      document,
      HTMLElement: Node,
      Node,
      Error,
      crypto: { randomUUID: () => "stable-id" },
    },
    unmount() {
      hooks.unmount();
      for (const node of attached) node.isConnected = false;
    },
  };
}
function routeFixture(initialTasks = [task]) {
  const f = environment(),
    calls = [],
    account = { isLoaded: true, isSignedIn: true, user: { id: "owner-a" } };
  const mutate = (name) => (args) => {
    const pending = deferred();
    calls.push({ name, args, ...pending });
    return pending.promise;
  };
  const route = loadUiModule(
    "src/routes/scheduled-tasks.tsx",
    {
      "@/components/ui/tabs": primitives("Tabs TabsContent TabsList TabsTrigger"),
      react: f.hooks.react,
      "@/styles/spec400-management.css": {},
      "@/components/ui/button": { Button: "button" },
      "@/components/ui/input": { Input: "input" },
      "@/components/ui/textarea": { Textarea: "textarea" },
      "@tanstack/react-router": {
        createFileRoute: () => (config) => ({ ...config, useSearch: () => ({}) }),
        Link: "Link",
      },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/lib/dialog-return-focus": f.restore,
      "@/hooks/use-principal-session-preferences": {
        usePrincipalSessionPreferences: () => {
          const [value, set] = f.hooks.react.useState({ query: "", filter: "active" });
          return [value, (patch) => set((old) => ({ ...old, ...patch }))];
        },
      },
      "@/lib/management-list-preferences.mjs": { MAX_MANAGEMENT_QUERY_LENGTH: 200 },
      "@/components/auth/ClerkSafe": { useUser: () => account },
      "@/hooks/use-time-format-preference": { useTimeFormatPreference: () => "system" },
      "@/lib/time-format": { formatDisplayDateTime: () => "Jan 1" },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/lib/scheduled-tasks.functions": {
        listScheduledTasks: async () => (account.user.id === "owner-a" ? initialTasks : []),
        isScheduledTasksEligible: async () => ({ eligible: true, executionAvailable: true }),
        updateScheduledTask: mutate("update"),
        deleteScheduledTask: mutate("delete"),
      },
      "lucide-react": new Proxy({}, { get: (_, name) => name }),
      sonner: { toast: { error() {}, success() {}, message() {} } },
      "@/components/AutomationBuilder": { AutomationBuilder: "AutomationBuilder" },
      "@/components/ScheduledTaskEditor": { ScheduledTaskEditor: "ScheduledTaskEditor" },
      "@/components/ScheduledTaskCopies": { ScheduledTaskCopies: "ScheduledTaskCopies" },
      "@/components/ScheduledTaskLastRun": { ScheduledTaskLastRun: "ScheduledTaskLastRun" },
      "@/components/WorkspaceIntelligence": { RelatedWorkspaceItems: "RelatedWorkspaceItems" },
      "@/hooks/use-scheduled-task-run-previews": { useScheduledTaskRunPreviews: () => ({}) },
      "@/lib/scheduled-task-run-page": { TASK_RUN_PAGE_SIZE: 20 },
      "@/components/ui/dropdown-menu": primitives(
        "DropdownMenu DropdownMenuTrigger DropdownMenuContent DropdownMenuItem DropdownMenuSeparator",
      ),
      "@/components/ui/alert-dialog": primitives(
        "AlertDialog AlertDialogAction AlertDialogCancel AlertDialogContent AlertDialogDescription AlertDialogFooter AlertDialogHeader AlertDialogTitle",
      ),
      "@/lib/principal-browser-storage.mjs": {
        browserStoragePrincipal: (id) => id,
        consumePrincipalHandoff: () => ({ ok: false, reason: "missing" }),
        isPrincipalBrowserStorageClearedEvent: () => true,
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "cleared",
        safeBrowserStorage: () => null,
      },
    },
    f.globals,
  ).Route;
  f.start(route.component);
  return {
    ...f,
    calls,
    account,
    async ready() {
      for (let i = 0; i < 4; i++) await f.flush();
    },
    async finish(error = false, index = calls.length - 1, status = "paused") {
      error
        ? calls[index].reject(new Error("Response interrupted"))
        : calls[index].resolve({
            ...initialTasks.find((item) => item.id === calls[index].args.data.id),
            status,
            revision: 5,
          });
      await f.flush();
    },
    select(label, title = task.title) {
      const menu = elements(
        f.tree(),
        (item) =>
          item.type === "DropdownMenu" &&
          elements(item, (child) => child.props["aria-label"] === `More actions for ${title}`)
            .length,
      )[0];
      const source = elements(
        menu,
        (item) => item.type === "DropdownMenuItem" && normalized(item) === label,
      )[0];
      const content = elements(menu, (item) => item.type === "DropdownMenuContent")[0];
      source.node.focus();
      source.props.onSelect({ currentTarget: source.node });
      f.render();
      // Model the menu portal closing while its originating row button is disabled.
      source.node.isConnected = false;
      f.document.activeElement = f.document.body;
      let prevented = false;
      content.props.onCloseAutoFocus({
        preventDefault() {
          prevented = true;
        },
      });
      f.framesNow();
      return { prevented, openerDisabled: f.nodes.get(`More actions for ${title}`).disabled };
    },
  };
}

test("pause failure stays named and focusable, and identical retry succeeds after its active row disappears", async () => {
  const f = routeFixture();
  await f.ready();
  const closing = f.select("Pause");
  assert.deepEqual(closing, { prevented: true, openerDisabled: true });
  const region = "Action status for Morning briefing";
  assert.equal(f.document.activeElement, f.nodes.get(region));
  assert.match(text(f.byLabel(region)), /Saving change/);
  assert.equal(f.byLabel(region).props["aria-busy"], true);
  await f.finish(true);
  assert.match(text(f.byLabel(region)), /Couldn’t confirm pause.*Response interrupted/);
  assert.ok(f.find("button", "Morning briefing"));
  assert.equal(f.document.activeElement, f.nodes.get(region));
  for (let i = 0; i < 5; i++) f.render();
  f.click("button", "Retry pause for “Morning briefing”");
  assert.deepEqual(f.calls[1].args, f.calls[0].args);
  assert.deepEqual(
    { ...f.calls[0].args.data },
    {
      expectedUserId: "owner-a",
      id: "task-one",
      mutationId: "stable-id",
      expectedRevision: 4,
      status: "paused",
    },
  );
  await f.finish();
  assert.match(text(f.byLabel(region)), /“Morning briefing” paused/);
  assert.equal(f.find("button", "Morning briefing"), undefined);
  assert.equal(f.document.activeElement, f.nodes.get(region));
});

test("pending result cannot reclaim later user focus; account and lifetime changes discard it", async () => {
  const f = routeFixture();
  await f.ready();
  f.select("Pause");
  const other = new f.Node("new focus");
  other.focus();
  await f.finish(true);
  assert.equal(f.document.activeElement, other);
  f.click("button", "Retry pause for “Morning briefing”");
  f.account.user = { id: "owner-b" };
  f.render();
  await f.ready();
  other.focus();
  await f.finish();
  assert.doesNotMatch(text(f.tree()), /Morning briefing/);
  assert.equal(f.document.activeElement, other);
  const g = routeFixture();
  await g.ready();
  g.select("Pause");
  g.unmount();
  g.calls[0].reject(new Error("late"));
  await settle();
  g.framesNow();
  assert.equal(
    g.focusEvents.filter((value) => value === "Action status for Morning briefing").length,
    1,
  );
});

test("delete confirmation is explicit and safe by default; dismissals do not mutate and restore exact opener", async () => {
  const f = routeFixture();
  await f.ready();
  for (const dismiss of ["cancel", "escape"]) {
    f.select("Delete");
    const content = f.find("AlertDialogContent");
    assert.equal(f.find("AlertDialog").props.open, true);
    assert.match(
      normalized(content),
      /Delete “Morning briefing”\?.*run history.*Pending copy offers will be revoked/s,
    );
    content.props.onOpenAutoFocus({ preventDefault() {} });
    assert.equal(f.document.activeElement, f.find("AlertDialogCancel").node);
    if (dismiss === "escape") {
      let prevented = false;
      content.props.onEscapeKeyDown({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, false);
    }
    f.find("AlertDialog").props.onOpenChange(false);
    f.render();
    content.props.onCloseAutoFocus({ target: content.node, preventDefault() {} });
    assert.equal(f.document.activeElement, f.nodes.get("More actions for Morning briefing"));
  }
  assert.equal(f.calls.length, 0);
});

test("mocked deletion failure remains inside confirmation and the same request retries with duplicate guards", async () => {
  const f = routeFixture();
  await f.ready();
  f.select("Delete");
  const action = f.find("AlertDialogAction");
  action.node.focus();
  const event = { currentTarget: action.node, preventDefault() {} };
  action.props.onClick(event);
  action.props.onClick(event);
  f.render();
  f.framesNow();
  assert.equal(f.calls.length, 1);
  assert.equal(f.document.activeElement, f.nodes.get("Delete status for Morning briefing"));
  let prevented = false;
  f.find("AlertDialogContent").props.onEscapeKeyDown({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  await f.finish(true);
  assert.equal(f.find("AlertDialog").props.open, true);
  assert.match(
    text(f.find("AlertDialogContent")),
    /Couldn’t confirm delete.*Response interrupted/s,
  );
  f.click("AlertDialogAction", "Retry the same delete request");
  assert.deepEqual(f.calls[1].args, f.calls[0].args);
  const content = f.find("AlertDialogContent");
  await f.finish();
  content.props.onCloseAutoFocus({ target: content.node, preventDefault() {} });
  assert.equal(f.find("AlertDialog").props.open, false);
  assert.match(text(f.byLabel("Action status for Morning briefing")), /deleted/);
  assert.equal(f.document.activeElement, f.nodes.get("Action status for Morning briefing"));
});

function editorFixture() {
  const f = environment(),
    calls = [];
  const mutate = (args) => {
    const p = deferred();
    calls.push({ args, ...p });
    return p.promise;
  };
  const exports = loadUiModule(
    "src/components/ScheduledTaskEditor.tsx",
    {
      react: f.hooks.react,
      "@/styles/spec400-management.css": {},
      "@/components/ui/button": { Button: "button" },
      "@/components/ui/input": { Input: "input" },
      "@/components/ui/textarea": { Textarea: "textarea" },
      "@/components/ui/dialog": primitives("Dialog DialogContent DialogTitle DialogDescription"),
      "@/components/ui/alert-dialog": primitives(
        "AlertDialog AlertDialogAction AlertDialogCancel AlertDialogContent AlertDialogDescription AlertDialogFooter AlertDialogHeader AlertDialogTitle",
      ),
      "@/components/TaskGmailEventSource": { TaskGmailEventSource: "TaskGmailEventSource" },
      "@/components/ui/select": {
        Select: "Select",
        SelectContent: "SelectContent",
        SelectItem: "SelectItem",
        SelectTrigger: "SelectTrigger",
        SelectValue: "SelectValue",
      },
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/lib/dialog-return-focus": f.restore,
      "@/lib/time-format": { formatDisplayDateTime: () => "Jan 1" },
      "@/lib/scheduled-tasks.functions": {
        createScheduledTask: mutate,
        updateScheduledTask: mutate,
        offerScheduledTaskCopy: mutate,
        listScheduledTaskConnections: async () => ({ connections: [], grants: [] }),
      },
      "@/lib/scheduled-task-run-labels": {
        taskRunStatusLabel: () => "",
        taskRunDeliveryLabel: () => "",
        taskRunFailureLabel: () => "",
      },
      "@/lib/scheduled-task-draft-validation": { validateScheduledTaskDraft: () => [] },
    },
    f.globals,
  );
  const props = {
    userKey: "owner-a",
    draft: {
      title: "Draft title",
      prompt: "Draft prompt",
      localTime: "2027-01-01T09:00",
      repeat: "daily",
    },
    executionAvailable: true,
    onClose() {},
    onSaved() {},
  };
  f.start(exports.ScheduledTaskEditor(props).type, props);
  return {
    ...f,
    calls,
    async fail(index = calls.length - 1) {
      calls[index].reject(new Error("Save response interrupted"));
      await f.flush();
    },
    submit() {
      const submit = f.find("button", "Save schedule");
      submit.node.focus();
      f.find("form").props.onSubmit({ preventDefault() {} });
      f.render();
      f.framesNow();
    },
  };
}

test("editor failure focuses and reveals persistent recovery while preserving the locked request and draft", async () => {
  const f = editorFixture();
  await f.flush();
  const surface = f.find("DialogContent").node;
  surface.scrollTop = 1400;
  f.submit();
  await f.fail();
  const error = f.byLabel("Scheduled task action failed");
  assert.match(text(error), /Couldn’t confirm task creation.*Save response interrupted/s);
  assert.equal(f.document.activeElement, error.node);
  assert.equal(surface.scrollTop, 0);
  assert.deepEqual(f.scrolls, [], "Reveal uses the dialog's actual scroll surface");
  assert.equal(f.find("fieldset").props.disabled, true);
  const values = elements(
    f.tree(),
    (item) => item.type === "input" || item.type === "textarea",
  ).map((item) => item.props.value);
  assert.ok(values.includes("Draft title"));
  assert.ok(values.includes("Draft prompt"));
  f.click("button", "Retry the same request");
  assert.deepEqual(f.calls[1].args, f.calls[0].args);
  const other = new f.Node("new focus");
  surface.scrollTop = 900;
  other.focus();
  await f.fail();
  assert.equal(f.document.activeElement, other);
  assert.equal(surface.scrollTop, 900);
});

test("an unmounted editor does not focus late create failure", async () => {
  const f = editorFixture();
  await f.flush();
  f.submit();
  const other = new f.Node("next account");
  other.focus();
  f.unmount();
  f.calls[0].reject(new Error("late old account"));
  await settle();
  f.framesNow();
  assert.equal(f.document.activeElement, other);
  assert.equal(f.scrolls.length, 0);
});

test("completed results are bounded and dismissible without evicting pending or failed work", async () => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    ...task,
    id: `task-${index}`,
    title: `Briefing ${index}`,
  }));
  const f = routeFixture(tasks);
  await f.ready();
  f.select("Pause", "Briefing 0");
  await f.finish(true);
  f.select("Pause", "Briefing 1");
  for (let index = 2; index < tasks.length; index++) {
    f.select("Pause", `Briefing ${index}`);
    await f.finish();
  }
  assert.match(text(f.byLabel("Action status for Briefing 0")), /Couldn’t confirm pause/);
  assert.equal(f.byLabel("Action status for Briefing 1").props["aria-busy"], true);
  assert.equal(f.byLabel("Action status for Briefing 2"), undefined);
  assert.equal(
    elements(
      f.tree(),
      (item) =>
        item.type === "section" && item.props["aria-label"]?.startsWith("Action status for "),
    ).length,
    5,
  );
  f.click("button", "Dismiss result for “Briefing 5”");
  assert.equal(f.byLabel("Action status for Briefing 5"), undefined);
  assert.equal(f.document.activeElement, f.find("button", "Refresh").node);
});

test("a fast failure retains status focus when the menu portal closes after request cleanup", async () => {
  const f = routeFixture();
  await f.ready();
  const menu = f.find("DropdownMenuContent");
  f.click("DropdownMenuItem", "Pause", "onSelect");
  await f.finish(true);
  let prevented = false;
  menu.props.onCloseAutoFocus({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.document.activeElement, f.nodes.get("Action status for Morning briefing"));
});

test("resume and failed-run recovery preserve the complete captured action and identity", async () => {
  for (const [status, filter, action, retryLabel, expected] of [
    ["paused", "paused", "Resume", "Retry resume for “Morning briefing”", { status: "scheduled" }],
    [
      "failed",
      "all",
      "Retry failed run",
      "Retry failed run for “Morning briefing”",
      { status: "scheduled", retry: true },
    ],
  ]) {
    const f = routeFixture([{ ...task, status }]);
    await f.ready();
    const trigger = elements(
      f.tree(),
      (element) => element.type === "TabsTrigger" && element.props.value === filter,
    )[0];
    assert.ok(trigger, `The ${filter} task filter remains available`);
    f.find("Tabs").props.onValueChange(trigger.props.value);
    f.render();
    assert.equal(f.find("Tabs").props.value, filter);
    f.select(action);
    await f.finish(true);
    f.click("button", retryLabel);
    assert.deepEqual(f.calls[1].args, f.calls[0].args);
    for (const [key, value] of Object.entries(expected))
      assert.equal(f.calls[0].args.data[key], value);
    await f.finish(false, 1, "scheduled");
    assert.equal(f.document.activeElement, f.nodes.get("Action status for Morning briefing"));
  }
});

test("create rejection reveals the committed error after disabled Save triggers Radix's container fallback", async () => {
  const f = editorFixture();
  await f.flush();
  const surface = f.find("DialogContent").node;
  surface.scrollTop = 1400;
  f.submit();
  assert.equal(f.find("button", "Saving…").node.disabled, true);
  // Model the installed focus scope's MutationObserver: a disabled source loses
  // focus to body, then removing the loading label focuses the dialog container.
  f.document.activeElement = f.document.body;
  surface.focus();
  f.calls[0].reject(new Error("Save response interrupted"));
  await settle();
  f.framesNow();
  assert.equal(surface.scrollTop, 1400, "Do not reveal before React commits the error");
  f.render();
  f.framesNow();
  assert.equal(f.document.activeElement, f.byLabel("Scheduled task action failed").node);
  assert.equal(surface.scrollTop, 0);
  assert.ok(f.find("button", "Retry the same request"));
  assert.equal(f.find("fieldset").props.disabled, true);
});

test("native submitter owns the reveal even when pointer activation did not focus Save", async () => {
  const f = editorFixture();
  await f.flush();
  const surface = f.find("DialogContent").node;
  surface.scrollTop = 1400;
  surface.focus();
  const submitter = f.find("button", "Save schedule").node;
  f.find("form").props.onSubmit({ nativeEvent: { submitter }, preventDefault() {} });
  f.render();
  await f.fail();
  assert.equal(f.document.activeElement, f.byLabel("Scheduled task action failed").node);
  assert.equal(surface.scrollTop, 0);
});

test("real pointer or Tab movement to the dialog cancels the automatic reveal", async () => {
  for (const movement of ["pointerdown", "keydown"]) {
    const f = editorFixture();
    await f.flush();
    const surface = f.find("DialogContent").node;
    surface.scrollTop = 1400;
    f.submit();
    f.emit(movement, movement === "keydown" ? { key: "Tab" } : { target: surface });
    surface.focus();
    await f.fail();
    assert.equal(f.document.activeElement, surface);
    assert.equal(surface.scrollTop, 1400);
  }
});

test("newer user focus between the error commit and reveal frame is respected", async () => {
  const f = editorFixture();
  await f.flush();
  const surface = f.find("DialogContent").node;
  surface.scrollTop = 1400;
  f.submit();
  f.calls[0].reject(new Error("Save response interrupted"));
  await settle();
  f.render();
  const other = new f.Node("new focus after commit");
  other.focus();
  f.framesNow();
  assert.equal(f.document.activeElement, other);
  assert.equal(surface.scrollTop, 1400);
});

test("an immediate same-message retry failure still reveals after batched busy updates", async () => {
  const f = editorFixture();
  await f.flush();
  f.submit();
  await f.fail();
  const surface = f.find("DialogContent").node;
  surface.scrollTop = 1400;
  const retry = f.find("button", "Retry the same request");
  retry.node.focus();
  retry.props.onClick({ currentTarget: retry.node });
  // Resolve before another render: busy=true and busy=false can be batched while
  // the prior and next error strings are identical.
  f.calls[1].reject(new Error("Save response interrupted"));
  await settle();
  f.render();
  f.framesNow();
  assert.equal(f.document.activeElement, f.byLabel("Scheduled task action failed").node);
  assert.equal(surface.scrollTop, 0);
  assert.deepEqual(f.calls[1].args, f.calls[0].args);
});
