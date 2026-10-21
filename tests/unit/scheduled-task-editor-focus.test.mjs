import test from "node:test";
import assert from "node:assert/strict";
import * as timeFormat from "../../src/lib/time-format.ts";
import { parseTaskPayload } from "../../src/lib/scheduled-task-policy.mjs";
import { loadUiModule, elements, text, settle, deferred } from "../helpers/ui-state-harness.mjs";

// Simulated ref commits exercise focus lifecycle without making real service calls.
function fixture({
  replaceTriggerOnSave = false,
  onCloseAutoFocus,
  updateResult,
  initialSection = "settings",
  historyResult,
  newTask = false,
  autoFocusBeforeEffects = false,
} = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const cleanups = [];
  const frames = [];
  const requests = [];
  const historyRequests = [];
  const scrolls = [];
  const document = {
    activeElement: null,
    body: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    location: { href: "https://fixture.test/scheduled-tasks" },
    requestAnimationFrame: (callback) => frames.push(callback),
    confirm() {
      assert.fail("The editor must use the shared confirmation, never window.confirm");
    },
  };
  class Element {
    constructor(name, parent = null) {
      this.name = name;
      this.parentElement = parent;
      this.isConnected = true;
      this.ownerDocument = document;
      this.tabIndex = name === "trigger" ? 0 : -1;
    }
    scrollIntoView(options) {
      scrolls.push({ element: this, options });
    }
    focus() {
      document.activeElement = this;
    }
    contains(node) {
      return node === this || Boolean(node?.parentElement && this.contains(node.parentElement));
    }
    closest(selector) {
      return selector === "main" ? page : this.inert ? this : null;
    }
    querySelector(selector) {
      return selector === "h1" || selector === "h2" ? fallback : null;
    }
    matches() {
      return Boolean(this.disabled);
    }
    getClientRects() {
      return this.isConnected && !this.hidden ? [{}] : [];
    }
    hasAttribute() {
      return false;
    }
  }
  const page = new Element("main");
  const trigger = new Element("trigger", page);
  const fallback = new Element("list-heading", page);
  const dialog = new Element("dialog", page);
  const editor = new Element("editor", dialog);
  const heading = new Element("editor-heading", editor);
  const historySummary = new Element("history-summary", editor);
  const titleInput = new Element("title-input", editor);
  const keepEditing = new Element("keep-editing");
  editor.nextElementSibling = { querySelector: () => fallback };
  document.body = new Element("body");
  document.activeElement = trigger;
  const react = {
    useId() {
      return `validation-${cursor++}`;
    },
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [
        slots[slot],
        (value) => {
          slots[slot] = typeof value === "function" ? value(slots[slot]) : value;
        },
      ];
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial });
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      if (!slots[slot] || dependencies.some((value, index) => value !== slots[slot][index]))
        effects.push(() => {
          cleanups[slot]?.();
          cleanups[slot] = effect();
        });
      slots[slot] = dependencies;
    },
  };
  let saves = 0;
  let closes = 0;
  const serviceNames = [
    "createScheduledTask",
    "updateScheduledTask",
    "offerScheduledTaskCopy",
    "listScheduledTaskRuns",
    "listScheduledTaskConnections",
    "grantScheduledTaskConnection",
    "revokeScheduledTaskConnection",
    "listScheduledTaskContextOptions",
    "listScheduledTaskResourceOptions",
  ];
  const services = Object.fromEntries(
    serviceNames.map((name) => [name, async () => ({ connections: [], grants: [] })]),
  );
  services.listScheduledTaskRuns = async (request) => {
    historyRequests.push(request.data);
    return historyResult ? historyResult.promise : [];
  };
  for (const name of ["createScheduledTask", "updateScheduledTask", "offerScheduledTaskCopy"])
    services[name] = async (request) => {
      requests.push({ name, data: request.data });
      return updateResult ? updateResult.promise : {};
    };
  const module = loadUiModule(
    "src/components/ScheduledTaskEditor.tsx",
    {
      react,
      "@/styles/spec400-management.css": {},
      "@/lib/time-format": timeFormat,
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
      "@/components/ui/dialog": {
        Dialog: "dialog",
        DialogContent: "dialog-content",
        DialogTitle: "dialog-title",
        DialogDescription: "dialog-description",
      },
      "@/components/ui/alert-dialog": {
        AlertDialog: "alert-dialog",
        AlertDialogContent: "alert-dialog-content",
        AlertDialogHeader: "alert-dialog-header",
        AlertDialogTitle: "alert-dialog-title",
        AlertDialogDescription: "alert-dialog-description",
        AlertDialogFooter: "alert-dialog-footer",
        AlertDialogCancel: "alert-dialog-cancel",
        AlertDialogAction: "alert-dialog-action",
      },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/components/TaskGmailEventSource": { TaskGmailEventSource: "gmail-source" },
      "@/components/ui/searchable-picker": { SearchablePicker: "searchable-picker" },
      "@/lib/scheduled-tasks.functions": services,
      "@/lib/scheduled-task-draft-validation": loadUiModule(
        "src/lib/scheduled-task-draft-validation.ts",
        { "@/lib/scheduled-task-policy.mjs": { parseTaskPayload } },
      ),
      "@/lib/scheduled-task-run-labels": loadUiModule("src/lib/scheduled-task-run-labels.ts", {}),
    },
    {
      HTMLElement: Element,
      Node: Element,
      Error,
      document,
      window,
      crypto: { randomUUID: () => "fixture-id" },
    },
  );
  const props = {
    userKey: "fixture-user",
    executionAvailable: false,
    onCloseAutoFocus,
    initialSection,
    task: newTask
      ? undefined
      : {
          id: "fixture-task",
          title: "Existing task",
          prompt: "Existing prompt",
          timezone: "UTC",
          repeat: "none",
          status: "paused",
          revision: 1,
          schedule_local: "2026-10-18T10:00",
        },
    onSaved() {
      saves++;
      if (replaceTriggerOnSave) trigger.isConnected = false;
    },
    onClose() {
      closes++;
      editor.isConnected = false;
      document.activeElement = document.body;
    },
  };
  let tree;
  let firstRender = true;
  function render() {
    cursor = 0;
    effects = [];
    const body = module.ScheduledTaskEditor(props);
    tree = body.type(body.props);
    for (const element of elements(tree, (node) => Boolean(node.props.ref))) {
      if (typeof element.props.ref !== "function")
        element.props.ref.current =
          element.type === "form"
            ? editor
            : element.type === "dialog-content"
              ? dialog
              : element.type === "summary"
                ? historySummary
                : element.type === "alert-dialog-cancel"
                  ? keepEditing
                  : heading;
      else if (element.props.id?.endsWith("-title")) element.props.ref(titleInput);
    }
    if (firstRender && autoFocusBeforeEffects) openingAutoFocus(true);
    firstRender = false;
    effects.forEach((effect) => effect());
  }
  const node = (type) => elements(tree, (element) => element.type === type)[0];
  function openingAutoFocus(simulateDefault = false) {
    let prevented = false;
    node("dialog-content").props.onOpenAutoFocus?.({
      preventDefault() {
        prevented = true;
      },
    });
    // Radix selects the first input when its opening event is not prevented.
    if (simulateDefault && !prevented) titleInput.focus();
    return prevented;
  }
  const autoFocus = (name) => {
    let prevented = false;
    node("alert-dialog-content").props[name]({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true, "The nested scope must not override the chosen focus target");
  };
  render();
  return {
    document,
    page,
    trigger,
    fallback,
    dialog,
    editor,
    heading,
    historySummary,
    titleInput,
    keepEditing,
    requests,
    historyRequests,
    scrolls,
    openingAutoFocus,
    render,
    get tree() {
      return tree;
    },
    get confirmationOpen() {
      return node("alert-dialog").props.open;
    },
    get title() {
      return elements(tree, (element) => element.props.id?.endsWith("-title"))[0].props.value;
    },
    changeTitle(value = "Changed task") {
      elements(
        tree,
        (element) => element.type === "input" && element.props.id?.endsWith("-title"),
      )[0].props.onChange({ target: { value } });
      render();
    },
    escape() {
      let prevented = false;
      elements(tree, (node) => node.type === "dialog-content")[0].props.onEscapeKeyDown({
        preventDefault() {
          prevented = true;
        },
      });
      if (!prevented) elements(tree, (node) => node.type === "dialog")[0].props.onOpenChange(false);
      render();
      return prevented;
    },
    confirmationAutoFocus() {
      autoFocus("onOpenAutoFocus");
    },
    confirmationCloseAutoFocus() {
      autoFocus("onCloseAutoFocus");
      render();
    },
    cancelConfirmation() {
      // AlertDialogCancel and Escape both use Radix's onOpenChange(false).
      node("alert-dialog").props.onOpenChange(false);
      render();
    },
    discard() {
      let prevented = false;
      node("alert-dialog-action").props.onClick({
        preventDefault() {
          prevented = true;
        },
      });
      if (!prevented) node("alert-dialog").props.onOpenChange(false);
      render();
      return prevented;
    },
    unmount() {
      cleanups.forEach((cleanup) => cleanup?.());
      editor.isConnected = false;
    },
    reopen() {
      cleanups.forEach((cleanup) => cleanup?.());
      cleanups.length = 0;
      slots.length = 0;
      editor.isConnected = true;
      document.activeElement = trigger;
      render();
    },
    autofocus(event) {
      const callback = elements(tree, (node) => node.type === "dialog-content")[0].props
        .onCloseAutoFocus;
      assert.equal(callback, onCloseAutoFocus);
      callback(event);
    },
    pendingFrames() {
      return frames.length;
    },
    get saves() {
      return saves;
    },
    get closes() {
      return closes;
    },
    frame() {
      frames.splice(0).forEach((callback) => callback());
    },
    close() {
      elements(
        tree,
        (node) => node.type === "button" && text(node) === "Cancel",
      )[0].props.onClick();
      render();
    },
    save() {
      const consent = elements(
        tree,
        (node) => node.type === "input" && node.props.type === "checkbox",
      ).at(-1);
      consent.props.onChange({ target: { checked: true } });
      render();
      elements(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
    },
  };
}

for (const autoFocusBeforeEffects of [false, true]) {
  test(`history entry focuses and reveals its summary ${autoFocusBeforeEffects ? "before" : "after"} mount effects`, async () => {
    const historyResult = deferred();
    const view = fixture({ initialSection: "history", historyResult, autoFocusBeforeEffects });
    if (!autoFocusBeforeEffects) assert.equal(view.openingAutoFocus(true), true);
    const summary = elements(
      view.tree,
      (node) => node.type === "summary" && text(node) === "Run history and results",
    )[0];
    const details = elements(
      view.tree,
      (node) => node.type === "details" && text(node).includes("Run history and results"),
    )[0];
    assert.equal(text(summary), "Run history and results");
    assert.equal(summary.props.tabIndex, undefined, "Keep the native summary keyboard behavior");
    assert.equal(details.props.open, true);
    assert.equal(view.document.activeElement, view.historySummary);
    assert.equal(view.scrolls.length, 1);
    assert.equal(view.scrolls[0].element, view.historySummary);
    assert.equal(view.scrolls[0].options.block, "start");
    assert.equal(view.historyRequests.length, 1);
    assert.equal(view.historyRequests[0].expectedUserId, "fixture-user");
    assert.equal(view.historyRequests[0].taskId, "fixture-task");
    assert.equal(view.title, "Existing task");
    assert.equal(view.requests.length, 0);
    assert.equal(view.pendingFrames(), 0, "Opening focus needs no delayed work");

    view.titleInput.focus();
    view.render();
    historyResult.resolve([
      {
        id: "run-1",
        status: "succeeded",
        scheduled_for: "2026-10-18T10:00:00Z",
        delivery_status: "delivered",
        result_summary: "Existing saved result",
      },
    ]);
    await settle();
    view.render();
    assert.match(text(view.tree), /Existing saved result/);
    assert.equal(view.historyRequests.length, 1, "Focus and rerenders must not repeat the read");
    assert.equal(view.document.activeElement, view.titleInput, "Results do not steal newer focus");
    assert.equal(view.scrolls.length, 1);
  });
}

test("settings and new-task entries retain ordinary autofocus without automatically reading history", () => {
  for (const options of [{}, { initialSection: "history", newTask: true }]) {
    const view = fixture(options);
    assert.equal(view.document.activeElement, view.heading);
    assert.equal(view.openingAutoFocus(true), false);
    assert.equal(view.document.activeElement, view.titleInput);
    assert.equal(view.historyRequests.length, 0);
    assert.equal(view.scrolls.length, 0);
    assert.equal(view.pendingFrames(), 0);
  }
});

test("history autofocus before mount effects preserves the standalone opener on Close", () => {
  const view = fixture({ initialSection: "history", autoFocusBeforeEffects: true });
  assert.equal(view.document.activeElement, view.historySummary);
  view.close();
  view.frame();
  assert.equal(view.closes, 1);
  assert.equal(view.document.activeElement, view.trigger);
});

test("empty and failed history reads keep the requested summary focused without rereading", async () => {
  for (const outcome of ["empty", "error"]) {
    const historyResult = deferred();
    const view = fixture({ initialSection: "history", historyResult });
    assert.equal(view.openingAutoFocus(true), true);
    if (outcome === "empty") historyResult.resolve([]);
    else historyResult.reject(new Error("History unavailable"));
    await settle();
    view.render();
    assert.match(text(view.tree), outcome === "empty" ? /No runs yet\./ : /History unavailable/);
    assert.equal(view.document.activeElement, view.historySummary);
    assert.equal(view.historyRequests.length, 1);
    assert.equal(view.scrolls.length, 1);
    assert.equal(view.pendingFrames(), 0);
    assert.equal(view.requests.length, 0);
  }
});

test("unavailable history targets leave default opening autofocus intact", () => {
  for (const unavailable of ["missing", "removed", "outside", "hidden", "inert"]) {
    const view = fixture({ initialSection: "history" });
    if (unavailable === "missing")
      elements(
        view.tree,
        (node) => node.type === "summary" && text(node) === "Run history and results",
      )[0].props.ref.current = null;
    else if (unavailable === "removed") view.historySummary.isConnected = false;
    else if (unavailable === "outside") view.historySummary.parentElement = view.page;
    else view.historySummary[unavailable] = true;
    assert.equal(view.openingAutoFocus(true), false, unavailable);
    assert.equal(view.document.activeElement, view.titleInput, unavailable);
    assert.equal(view.scrolls.length, 0, unavailable);
  }
});

test("unmounting history entry cancels focus ownership and late read completion cannot reveal it", async () => {
  for (const outcome of ["resolved", "rejected"]) {
    const historyResult = deferred();
    const view = fixture({ initialSection: "history", historyResult });
    assert.equal(view.openingAutoFocus(true), true);
    view.unmount();
    view.fallback.focus();
    assert.equal(view.openingAutoFocus(), false);
    if (outcome === "resolved") historyResult.resolve([]);
    else historyResult.reject(new Error("History unavailable"));
    await settle();
    view.frame();
    assert.equal(view.document.activeElement, view.fallback);
    assert.equal(view.historyRequests.length, 1);
    assert.equal(view.scrolls.length, 1);
    assert.equal(view.pendingFrames(), 0);
    assert.equal(view.closes, 0);
  }
});

test("history entry preserves dirty-close confirmation and the supplied exact-opener restoration", () => {
  let returns = 0;
  const view = fixture({
    initialSection: "history",
    onCloseAutoFocus(event) {
      event.preventDefault();
      returns++;
      view.trigger.focus();
    },
  });
  view.openingAutoFocus(true);
  view.changeTitle();
  view.titleInput.focus();
  view.escape();
  assert.equal(view.confirmationOpen, true);
  assert.equal(view.closes, 0);
  view.confirmationAutoFocus();
  view.cancelConfirmation();
  view.confirmationCloseAutoFocus();
  assert.equal(view.document.activeElement, view.titleInput);
  assert.equal(view.title, "Changed task");
  view.changeTitle("Existing task");
  view.escape();
  assert.equal(view.closes, 1);
  assert.equal(returns, 0);
  assert.equal(view.pendingFrames(), 0);
  view.autofocus({ preventDefault() {} });
  assert.equal(returns, 1);
  assert.equal(view.document.activeElement, view.trigger);
  assert.equal(view.historyRequests.length, 1);
  assert.equal(view.requests.length, 0);
});

test("modal editor focuses its heading, then restores the connected opener on Close", () => {
  const view = fixture();
  assert.equal(view.document.activeElement, view.heading);
  view.close();
  view.frame();
  assert.equal(view.confirmationOpen, false);
  assert.equal(view.document.activeElement, view.trigger);
  assert.equal(view.closes, 1);
});

test("restoring the original draft closes cleanly without a discard confirmation", () => {
  const view = fixture();
  view.changeTitle();
  view.changeTitle("Existing task");
  view.escape();
  assert.equal(view.confirmationOpen, false);
  assert.equal(view.closes, 1);
  assert.equal(view.requests.length, 0);
});

test("saving uses the persistent task-list heading when refresh replaces its original row", async () => {
  const view = fixture({ replaceTriggerOnSave: true });
  view.save();
  await settle();
  view.frame();
  assert.equal(view.saves, 1);
  assert.equal(view.closes, 1);
  assert.equal(view.document.activeElement, view.fallback);
});

test("closing does not steal a newer focus target or focus the page after navigation", () => {
  const view = fixture();
  view.close();
  view.document.activeElement = view.fallback;
  view.frame();
  assert.equal(view.document.activeElement, view.fallback);
  const navigated = fixture();
  navigated.close();
  navigated.page.isConnected = false;
  navigated.frame();
  assert.equal(navigated.document.activeElement, navigated.document.body);
});

test("the supplied close-autofocus hook owns restoration after Escape, without a competing frame", () => {
  let calls = 0;
  const event = { preventDefault() {} };
  const view = fixture({
    onCloseAutoFocus(received) {
      assert.equal(received, event);
      calls++;
      view.trigger.focus();
    },
  });
  view.escape();
  assert.equal(view.closes, 1);
  assert.equal(view.pendingFrames(), 0);
  assert.equal(calls, 0);
  assert.equal(view.document.activeElement, view.document.body);
  view.autofocus(event);
  assert.equal(calls, 1);
  assert.equal(view.document.activeElement, view.trigger);
});

test("dirty Escape opens a named shared confirmation with safe Keep editing focus", () => {
  const view = fixture({
    onCloseAutoFocus() {
      assert.fail("The dialog remains open");
    },
  });
  view.changeTitle();
  view.titleInput.focus();
  view.escape();
  assert.equal(view.confirmationOpen, true);
  assert.equal(view.title, "Changed task");
  assert.equal(view.closes, 0);
  assert.equal(view.pendingFrames(), 0);
  const title = elements(view.tree, (node) => node.type === "alert-dialog-title")[0];
  const description = elements(view.tree, (node) => node.type === "alert-dialog-description")[0];
  assert.equal(text(title), "Discard unsaved schedule changes?");
  assert.match(text(description), /Changed task/);
  assert.match(text(description), /will be lost/);
  view.confirmationAutoFocus();
  assert.equal(view.document.activeElement, view.keepEditing);
  // An Escape delivered to the underlying editor cannot dismiss both layers.
  assert.equal(view.escape(), true);
  assert.equal(view.closes, 0);
  assert.equal(view.requests.length, 0);
});

test("Keep editing and confirmation Escape preserve the current draft and restore editor focus", () => {
  const view = fixture();
  for (const title of ["First changed title", "Latest changed title"]) {
    view.changeTitle(title);
    view.titleInput.focus();
    view.close();
    assert.equal(view.confirmationOpen, true);
    view.confirmationAutoFocus();
    view.cancelConfirmation();
    assert.equal(view.confirmationOpen, false);
    // Repeated close during the confirmation's exit cannot reopen it or change the decision.
    view.close();
    assert.equal(view.confirmationOpen, false);
    view.confirmationCloseAutoFocus();
    assert.equal(view.document.activeElement, view.titleInput);
    assert.equal(view.title, title);
    assert.equal(view.closes, 0);
    assert.equal(view.pendingFrames(), 0);
  }
  assert.equal(view.requests.length, 0);
});

test("cancelled confirmation falls back to the editor heading when its field is disabled or removed", () => {
  for (const unavailable of ["removed", "disabled"]) {
    const view = fixture();
    view.changeTitle();
    view.titleInput.focus();
    view.close();
    view.confirmationAutoFocus();
    if (unavailable === "removed") view.titleInput.isConnected = false;
    else view.titleInput.disabled = true;
    view.cancelConfirmation();
    view.confirmationCloseAutoFocus();
    assert.equal(view.document.activeElement, view.heading);
    assert.equal(view.closes, 0);
  }
});

test("Discard closes only after its focus scope, then the existing editor hook restores the opener", () => {
  let returns = 0;
  const view = fixture({
    onCloseAutoFocus(event) {
      event.preventDefault();
      returns++;
      view.trigger.focus();
    },
  });
  view.changeTitle();
  view.close();
  view.confirmationAutoFocus();
  assert.equal(view.discard(), false);
  assert.equal(view.confirmationOpen, false);
  assert.equal(view.closes, 0, "The confirmation finishes closing before the editor unmounts");
  assert.equal(view.discard(), true, "Repeated confirmation cannot queue another close");
  view.confirmationCloseAutoFocus();
  assert.equal(view.closes, 1);
  assert.equal(view.pendingFrames(), 0);
  assert.equal(returns, 0);
  view.autofocus({ preventDefault() {} });
  assert.equal(returns, 1);
  assert.equal(view.document.activeElement, view.trigger);
  assert.equal(view.requests.length, 0);
  view.reopen();
  assert.equal(view.title, "Existing task");
  assert.equal(view.confirmationOpen, false);
  assert.equal(view.document.activeElement, view.heading);
});

test("unmounting before confirmation autofocus cannot close or refocus another editor", () => {
  const view = fixture();
  view.changeTitle();
  view.close();
  view.discard();
  view.unmount();
  view.fallback.focus();
  view.confirmationCloseAutoFocus();
  assert.equal(view.closes, 0);
  assert.equal(view.document.activeElement, view.fallback);
});

test("busy Escape remains blocked and a successful save uses the supplied restoration hook", async () => {
  const updateResult = deferred();
  let returns = 0;
  const view = fixture({
    updateResult,
    onCloseAutoFocus() {
      returns++;
    },
  });
  view.changeTitle();
  view.save();
  view.close();
  assert.equal(view.closes, 0, "A stale Cancel callback is blocked synchronously while saving");
  view.render();
  assert.equal(view.escape(), true);
  assert.equal(view.closes, 0);
  assert.equal(view.confirmationOpen, false);
  updateResult.resolve({});
  await settle();
  assert.equal(view.saves, 1);
  assert.equal(view.closes, 1);
  assert.equal(view.pendingFrames(), 0);
  view.autofocus({ preventDefault() {} });
  assert.equal(returns, 1);
});

test("an unconfirmed save keeps its existing gates and explains that closing cannot cancel it", async () => {
  const updateResult = deferred();
  const view = fixture({ updateResult, onCloseAutoFocus() {} });
  view.changeTitle();
  view.save();
  updateResult.reject(new Error("Response interrupted"));
  await settle();
  view.render();
  const save = elements(
    view.tree,
    (node) => node.type === "button" && text(node) === "Save paused",
  )[0];
  assert.equal(save.props.disabled, true);
  assert.equal(view.requests.length, 1);
  view.close();
  assert.equal(view.confirmationOpen, true);
  const description = elements(view.tree, (node) => node.type === "alert-dialog-description")[0];
  assert.match(text(description), /earlier request is still unconfirmed/);
  assert.match(text(description), /does not cancel it/);
  view.cancelConfirmation();
  view.confirmationCloseAutoFocus();
  assert.equal(view.title, "Changed task");
  assert.equal(view.requests.length, 1);
  assert.equal(view.closes, 0);
});

test("confirmation actions are shared non-submit controls outside the editor form", () => {
  const view = fixture();
  const form = elements(view.tree, (node) => node.type === "form")[0];
  assert.equal(elements(form, (node) => node.type.startsWith?.("alert-dialog")).length, 0);
  for (const type of ["alert-dialog-cancel", "alert-dialog-action"]) {
    const action = elements(view.tree, (node) => node.type === type)[0];
    assert.equal(action.props.type, "button");
  }
});
