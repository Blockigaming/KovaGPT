import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as timeFormat from "../../src/lib/time-format.ts";
import { parseTaskPayload } from "../../src/lib/scheduled-task-policy.mjs";
import { elements, text, loadUiModule, settle, deferred } from "../helpers/ui-state-harness.mjs";

const validation = loadUiModule("src/lib/scheduled-task-draft-validation.ts", {
  "@/lib/scheduled-task-policy.mjs": { parseTaskPayload },
});

function fixture({ task, draft, createResult, executionAvailable = true } = {}) {
  const slots = [],
    effects = [],
    focused = [],
    requests = [],
    dom = new Map();
  let cursor = 0,
    tree,
    saves = 0,
    closes = 0,
    ids = 0;
  const document = {
    activeElement: null,
    body: {},
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    location: { href: "https://fixture.test/scheduled-tasks" },
    requestAnimationFrame: (callback) => effects.push(callback),
  };
  document.activeElement = document.body;
  class Element {
    constructor(id) {
      this.id = id;
      this.ownerDocument = document;
      this.isConnected = true;
    }
    scrollIntoView() {}
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    matches() {
      return false;
    }
    focus() {
      document.activeElement = this;
      focused.push(this.id);
    }
    contains(element) {
      return element === this || dom.has(element?.id);
    }
    closest() {
      return null;
    }
  }
  const react = {
    useId() {
      return `validation-${cursor++}`;
    },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useRef(value) {
      return (slots[cursor++] ??= { current: value });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) effects.push(effect);
      slots[index] = deps;
    },
  };
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
  for (const name of ["createScheduledTask", "updateScheduledTask"])
    services[name] = async (request) => {
      requests.push({ name, data: request.data });
      if (createResult) return createResult(requests.length);
      return { id: "created-task" };
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
      "@/components/TaskGmailEventSource": { TaskGmailEventSource: "gmail-source" },
      "@/components/ui/select": {
        Select: "Select",
        SelectContent: "SelectContent",
        SelectItem: "SelectItem",
        SelectTrigger: "SelectTrigger",
        SelectValue: "SelectValue",
      },
      "@/components/ui/searchable-picker": { SearchablePicker: "searchable-picker" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/lib/scheduled-tasks.functions": services,
      "@/lib/scheduled-task-draft-validation": validation,
      "@/lib/scheduled-task-run-labels": loadUiModule("src/lib/scheduled-task-run-labels.ts", {}),
    },
    {
      HTMLElement: Element,
      Node: Element,
      document,
      crypto: { randomUUID: () => `fixture-${++ids}` },
      window,
    },
  );
  const props = {
    userKey: "user-a",
    executionAvailable,
    task,
    draft: draft ?? { title: "", prompt: "", localTime: "2028-02-29T09:00", repeat: "daily" },
    onCloseAutoFocus() {},
    onSaved() {
      saves++;
    },
    onClose() {
      closes++;
    },
  };
  function render() {
    cursor = 0;
    effects.length = 0;
    const body = module.ScheduledTaskEditor(props);
    tree = body.type(body.props);
    for (const element of elements(tree, (node) => Boolean(node.props.ref))) {
      const id =
        element.props.id ?? (element.props.role === "alert" ? "validation-summary" : element.type);
      const target = dom.get(id) ?? new Element(id);
      dom.set(id, target);
      if (typeof element.props.ref === "function") element.props.ref(target);
      else element.props.ref.current = target;
    }
    effects.splice(0).forEach((effect) => effect());
  }
  render();
  const field = (name) =>
    elements(
      tree,
      (node) => ["input", "textarea"].includes(node.type) && node.props.id?.endsWith(`-${name}`),
    )[0];
  return {
    field,
    focused,
    requests,
    document,
    render,
    get tree() {
      return tree;
    },
    get saves() {
      return saves;
    },
    get closes() {
      return closes;
    },
    summary() {
      return elements(tree, (node) => node.props.role === "alert" && node.props.tabIndex === -1)[0];
    },
    change(name, value) {
      field(name).props.onChange({ target: name === "consent" ? { checked: value } : { value } });
      render();
    },
    blur(name) {
      field(name).props.onBlur();
      render();
    },
    submit() {
      elements(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
      render();
    },
    retry() {
      elements(
        tree,
        (node) => node.type === "button" && text(node) === "Retry the same request",
      )[0].props.onClick();
      render();
    },
  };
}
const validDraft = {
  title: "Weekly review",
  prompt: "Review my notes",
  localTime: "2028-02-29T09:00",
  repeat: "weekly",
};

test("the full source tree gives every auxiliary and nested Gmail control an explicit non-submit type", () => {
  let submitCount = 0;
  for (const path of [
    "src/components/ScheduledTaskEditor.tsx",
    "src/components/TaskGmailEventSource.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (
        ts.isJsxOpeningElement(node) &&
        ["button", "Button"].includes(node.tagName.getText(parsed))
      ) {
        const attribute = node.attributes.properties.find(
          (item) => item.name?.getText(parsed) === "type",
        );
        assert.ok(
          attribute && ts.isStringLiteral(attribute.initializer),
          `${path}: ${node.getText(parsed)}`,
        );
        if (attribute.initializer.text === "submit") {
          submitCount++;
          assert.equal(path, "src/components/ScheduledTaskEditor.tsx");
          assert.match(node.parent.getText(parsed), /Save schedule/);
        } else assert.equal(attribute.initializer.text, "button");
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  assert.equal(submitCount, 1);
});

test("untouched fields are quiet; blur reveals only the visited error and correction removes it", () => {
  const f = fixture();
  assert.equal(f.summary(), undefined);
  assert.equal(f.field("title").props["aria-invalid"], undefined);
  f.blur("title");
  assert.equal(f.field("title").props["aria-invalid"], true);
  assert.equal(f.field("prompt").props["aria-invalid"], undefined);
  const errorId = f.field("title").props["aria-describedby"];
  assert.ok(elements(f.tree, (node) => node.props.id === errorId).length);
  f.change("title", "Filled title");
  assert.equal(f.field("title").props["aria-invalid"], undefined);
  assert.equal(f.field("title").props["aria-describedby"], undefined);
});

test("invalid submit focuses a linked summary, repeated attempts refocus, and each link focuses its field", () => {
  const f = fixture();
  f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.focused.at(-1), "validation-summary");
  const links = elements(f.summary(), (node) => node.type === "a");
  assert.equal(links.length, 3);
  for (const link of links) {
    link.props.onClick({ preventDefault() {} });
    assert.equal(f.focused.at(-1), link.props.href.slice(1));
  }
  f.submit();
  assert.equal(f.focused.at(-1), "validation-summary");
  for (const [name, value] of [
    ["title", "Task"],
    ["prompt", "Prompt"],
    ["consent", true],
  ])
    f.change(name, value);
  assert.equal(f.summary(), undefined);
});

test("valid submission preserves the existing creation payload, identity and consent gate", async () => {
  const f = fixture({ draft: validDraft });
  f.submit();
  assert.equal(f.requests.length, 0);
  assert.match(text(f.summary()), /confirmation checkbox/);
  f.change("consent", true);
  f.submit();
  await settle();
  f.render();
  assert.equal(f.requests.length, 1);
  const { data } = f.requests[0];
  assert.equal(data.title, validDraft.title);
  assert.equal(data.prompt, validDraft.prompt);
  assert.equal(data.localTime, validDraft.localTime);
  assert.equal(data.repeat, validDraft.repeat);
  assert.equal(data.expectedUserId, "user-a");
  assert.equal(data.triggerMode, "time");
  assert.equal(data.id, "fixture-1");
  assert.equal(data.mutationId, "fixture-2");
  assert.equal(Object.hasOwn(data, "consent"), false);
  assert.equal(f.saves, 1);
  assert.equal(f.closes, 1);
});

test("clearing date and time preserves the other field, and all visible errors link to real controls", () => {
  const f = fixture({ draft: validDraft });
  f.change("date", "");
  assert.equal(f.field("time").props.value, "09:00");
  f.blur("date");
  assert.equal(f.field("date").props["aria-invalid"], true);
  f.change("time", "");
  f.change("timezone", "not-a-zone");
  f.change("consent", true);
  f.submit();
  const links = elements(f.summary(), (node) => node.type === "a");
  assert.equal(links.length, 3);
  for (const field of ["date", "time", "timezone"]) {
    assert.equal(f.field(field).props["aria-invalid"], true);
    assert.ok(links.some((link) => link.props.href === `#${f.field(field).props.id}`));
  }
  f.change("date", "2028-02-29");
  assert.equal(f.field("time").props.value, "");
  assert.equal(f.field("time").props["aria-invalid"], true);
  assert.equal(f.requests.length, 0);
});

test("date/time and timezone feedback remains linked and event mode has no hidden schedule errors", () => {
  const task = {
    id: "event-task",
    title: "Events",
    prompt: "Review matching events",
    repeat: "none",
    timezone: "Invalid/Zone",
    schedule_local: "not-valid",
    trigger_mode: "event",
    event_triggers: [{ provider: "github", resource: "owner/repo" }],
    context_refs: [],
    status: "paused",
    revision: 3,
  };
  const f = fixture({ task });
  assert.equal(f.field("date"), undefined);
  assert.equal(f.field("time"), undefined);
  assert.ok(f.field("timezone"));
  f.change("consent", true);
  f.submit();
  const links = elements(f.summary(), (node) => node.type === "a");
  assert.equal(links.length, 1);
  assert.match(text(links[0]), /Timezone/);
  f.change("timezone", "UTC");
  f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].data.triggerMode, "event");
  assert.equal(f.requests[0].data.repeat, "none");
  assert.equal(f.requests[0].data.eventTriggers, task.event_triggers);
  assert.equal(Object.hasOwn(f.requests[0].data, "localTime"), false);
  assert.equal(f.requests[0].data.expectedRevision, 3);
});

test("uncertain creation reports uncertainty and retries the same frozen payload without revalidation", async () => {
  const f = fixture({
    draft: validDraft,
    createResult: async (attempt) => {
      if (attempt === 1) throw new Error("The commit or readback could not be confirmed.");
      return { id: "confirmed-task" };
    },
  });
  f.change("consent", true);
  f.submit();
  await settle();
  f.render();
  assert.match(text(f.tree), /Couldn’t confirm task creation/);
  assert.doesNotMatch(text(f.tree), /Scheduled task not created/);
  const original = f.requests[0].data;
  // Even programmatic state changes cannot rewrite the retained request while fields are locked.
  f.change("title", "");
  f.change("consent", false);
  f.retry();
  await settle();
  f.render();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].data, original);
  assert.equal(f.saves, 1);
});

test("busy and unavailable submissions remain blocked and every auxiliary button is non-submit", async () => {
  const pending = deferred();
  const f = fixture({ draft: validDraft, createResult: () => pending.promise });
  f.change("consent", true);
  f.submit();
  f.submit();
  assert.equal(f.requests.length, 1);
  for (const button of elements(f.tree, (node) => node.type === "button")) {
    assert.equal(button.props.type, text(button).trim() === "Saving…" ? "submit" : "button");
  }
  pending.resolve({ id: "saved" });
  await settle();
  const unavailable = fixture({ draft: validDraft, executionAvailable: false });
  unavailable.change("consent", true);
  unavailable.submit();
  assert.equal(unavailable.requests.length, 0);
});
