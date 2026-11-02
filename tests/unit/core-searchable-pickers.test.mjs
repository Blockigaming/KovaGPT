import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHookHarness } from "../helpers/ui-state-harness.mjs";

const source = (path) => readFileSync(path, "utf8");
const compile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const nodes = (node) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
};
const find = (tree, type) => nodes(tree).filter((node) => node.type === type);
const text = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  return typeof node === "object" ? text(node.props?.children) : String(node);
};
const primitives = new Proxy({}, { get: (_target, name) => name });

// Exercise actual component callbacks with isolated hooks and primitive tokens.
// This proves data/operation contracts without mounting an app or calling providers.
function harness(path, component, dependencies = {}) {
  const hooks = createHookHarness();
  const module = { exports: {} };
  vm.runInNewContext(compile(source(path)), {
    exports: module.exports,
    require(id) {
      if (id === "react") return hooks.react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "@/lib/utils") return { cn: (...values) => values.filter(Boolean).join(" ") };
      if (dependencies[id]) return dependencies[id];
      if (id === "lucide-react" || id.startsWith("./") || id.startsWith("@/components/"))
        return primitives;
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return (props) => hooks.render(module.exports[component], props);
}
const pickerPath = "src/components/ui/searchable-picker.tsx";
const options = (count) =>
  Array.from({ length: count }, (_, index) => ({
    value: `id-${index}`,
    label: `Choice ${index + 1}`,
  }));

test("short dynamic lists use the themed select; the eighth real choice enables search", () => {
  for (const count of [0, 3, 4, 7, 8]) {
    const render = harness(pickerPath, "SearchablePicker");
    const changes = [];
    const tree = render({
      options: options(count),
      value: "",
      onValueChange: (value) => changes.push(value),
      placeholder: "Choose a source",
      searchLabel: "Search sources",
      id: "source-picker",
      "aria-label": "Connected source",
      "aria-describedby": "source-help source-error",
      "aria-invalid": true,
    });
    if (count <= 7) {
      assert.equal(tree.type, "Select");
      assert.equal(find(tree, "select").length, 0);
      assert.equal(find(tree, "SelectItem").length, count + 1);
      const trigger = find(tree, "SelectTrigger")[0];
      assert.equal(trigger.props.id, "source-picker");
      assert.equal(trigger.props["aria-label"], "Connected source");
      assert.equal(trigger.props["aria-describedby"], "source-help source-error");
      assert.equal(trigger.props["aria-invalid"], true);
      tree.props.onValueChange("option:");
      assert.deepEqual(changes, [""]);
      if (count === 0) continue;
      tree.props.onValueChange("option:id-2");
      assert.deepEqual(changes, ["", "id-2"]);
    } else {
      assert.equal(tree.type, "Popover");
      assert.equal(find(tree, "select").length, 0);
      const button = find(tree, "button")[0];
      assert.equal(button.props.id, "source-picker");
      assert.equal(button.props["aria-label"], "Connected source");
      assert.equal(button.props["aria-describedby"], "source-help source-error");
      assert.equal(button.props["aria-invalid"], true);
      const list = nodes(tree).find((node) => typeof node.type === "function");
      assert.equal(list.props.options[0].value, "");
      list.props.onValueChange("id-2");
      assert.deepEqual(changes, ["id-2"]);
    }
  }
});

test("search matches visible labels, keeps duplicate-label ids distinct and marks the committed selection", () => {
  const render = harness(pickerPath, "SearchablePickerList");
  const changes = [];
  const tree = render({
    options: [
      { value: "first", label: "Shared label" },
      { value: "second", label: "Shared label" },
      { value: "locked", label: "Unavailable", disabled: true },
    ],
    value: "second",
    onValueChange: (value) => changes.push(value),
    searchLabel: "Search choices",
  });
  assert.equal(tree.type, "Command");
  assert.equal(tree.props.loop, true);
  assert.equal(tree.props.defaultValue, "option:second");
  assert.equal(tree.props.filter("option:first", "  SHARED  ", ["Shared label"]), 1);
  assert.equal(tree.props.filter("option:first", "missing", ["Shared label"]), 0);
  const input = find(tree, "CommandInput")[0];
  assert.equal(input.props.autoFocus, true);
  assert.equal(input.props["aria-label"], "Search choices");
  assert.equal(text(find(tree, "CommandEmpty")[0]), "No options found.");
  const items = find(tree, "CommandItem");
  assert.equal(items[0].props.value, "option:first");
  assert.equal(items[1].props.value, "option:second");
  assert.equal(find(items[0], "Check").length, 0);
  assert.equal(find(items[1], "Check").length, 1);
  items[1].props.onSelect();
  items[2].props.onSelect();
  assert.deepEqual(changes, ["second"]);
  const busyTree = render({
    options: options(8),
    value: "id-0",
    disabled: true,
    onValueChange: (value) => changes.push(value),
    searchLabel: "Search",
  });
  for (const item of find(busyTree, "CommandItem")) {
    assert.equal(item.props.disabled, true);
    item.props.onSelect();
  }
  assert.deepEqual(changes, ["second"]);
});

test("short themed lists preserve empty values and duplicate labels, reject disabled or unknown choices, and restore focus deliberately", () => {
  const render = harness(pickerPath, "SearchablePicker");
  const changes = [];
  const props = {
    options: [
      { value: "", label: "No project" },
      { value: "option:project-a", label: "Shared label" },
      { value: "project-b", label: "Shared label" },
      { value: "locked", label: "Unavailable", disabled: true },
    ],
    value: "",
    onValueChange: (value) => changes.push(value),
    searchLabel: "Choose a project",
    restoreFocusOnSelect: false,
  };
  let tree = render(props);
  assert.equal(tree.props.value, "option:");
  const items = find(tree, "SelectItem");
  assert.deepEqual(
    items.map((item) => item.props.value),
    ["option:", "option:option:project-a", "option:project-b", "option:locked"],
  );
  assert.equal(items[3].props.disabled, true);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  find(tree, "SelectContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 0);
  tree.props.onValueChange("option:locked");
  tree.props.onValueChange("not-an-option");
  assert.deepEqual(changes, []);
  tree.props.onValueChange("option:option:project-a");
  tree.props.onValueChange("option:project-b");
  tree.props.onValueChange("option:");
  assert.deepEqual(changes, ["option:project-a", "project-b", ""]);
  find(tree, "SelectContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 1);
  tree.props.onOpenChange(true);
  find(tree, "SelectContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 1);
  tree = render({ ...props, disabled: true });
  assert.equal(tree.props.disabled, true);
  tree.props.onValueChange("option:project-b");
  assert.deepEqual(changes, ["option:project-a", "project-b", ""]);
});

test("optional direction reaches short controls and portalled lists without changing default selection or focus", () => {
  for (const dir of [undefined, "ltr", "rtl"]) {
    for (const count of [7, 8]) {
      const render = harness(pickerPath, "SearchablePicker");
      const changes = [];
      const tree = render({
        options: options(count),
        value: "id-0",
        dir,
        "aria-label": "Language",
        searchLabel: "Search languages",
        onValueChange: (value) => changes.push(value),
      });
      if (count === 7) {
        assert.equal(tree.type, "Select");
        assert.equal(tree.props.dir, dir);
        assert.equal(find(tree, "SelectContent")[0].props.dir, dir);
        tree.props.onValueChange("option:id-1");
      } else {
        assert.equal(find(tree, "button")[0].props.dir, dir);
        const content = find(tree, "PopoverContent")[0];
        assert.equal(content.props.dir, dir);
        assert.equal(content.props.align, "start");
        const list = nodes(tree).find((node) => typeof node.type === "function");
        list.props.onValueChange("id-1");
        let prevented = false;
        content.props.onCloseAutoFocus({
          preventDefault: () => {
            prevented = true;
          },
        });
        assert.equal(prevented, false);
      }
      assert.deepEqual(changes, ["id-1"]);
    }
  }
});

test("selection may preserve Settings section focus while Escape retains normal return focus", () => {
  const render = harness(pickerPath, "SearchablePicker");
  const props = {
    options: options(8),
    value: "id-0",
    onValueChange() {},
    searchLabel: "Search sections",
    restoreFocusOnSelect: false,
  };
  let tree = render(props);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  find(tree, "PopoverContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 0);
  nodes(tree)
    .find((node) => typeof node.type === "function")
    .props.onValueChange("id-2");
  find(tree, "PopoverContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 1);
  tree.props.onOpenChange(true);
  tree = render(props);
  find(tree, "PopoverContent")[0].props.onCloseAutoFocus(event);
  assert.equal(prevented, 1);
});

function pickerElements(path) {
  const file = ts.createSourceFile(
    path,
    source(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "SearchablePicker")
      result.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}
function renderElement(element, values) {
  const context = {
    ...values,
    exports: {},
    SearchablePicker: "SearchablePicker",
    require: () => ({ jsx, jsxs: jsx }),
  };
  vm.runInNewContext(compile(`globalThis.result = (${element});`), context);
  return context.result;
}

test("Settings retains all primary sections and includes a legacy current section through selectTab", () => {
  const path = "src/components/SettingsDialog.tsx";
  const element = pickerElements(path)[0];
  const changes = [];
  const allTabs = options(8).map((item) => ({ v: item.value, label: item.label }));
  const tree = renderElement(element, {
    allTabs,
    tab: "legacy",
    activeTab: { label: "Legacy current" },
    selectTab: (value) => changes.push(value),
  });
  assert.equal(tree.props.options.length, 9);
  assert.equal(tree.props.options[8].value, "legacy");
  assert.equal(tree.props.options[8].label, "Legacy current");
  tree.props.onValueChange("id-1");
  assert.deepEqual(changes, ["id-1"]);
  assert.equal(tree.props.restoreFocusOnSelect, false);
  const normal = renderElement(element, {
    allTabs,
    tab: "id-1",
    activeTab: { label: "Choice 2" },
    selectTab() {},
  });
  assert.equal(normal.props.options.length, 8);
  const pageGroups = source(path)
    .split("const pageGroups: TabGroup[] = [")[1]
    .split("const groups")[0];
  assert.deepEqual(
    [...pageGroups.matchAll(/\bv: "([^"]+)"/g)].map((match) => match[1]),
    [
      "personalization",
      "appearance",
      "general",
      "memory",
      "security",
      "storage",
      "notifications",
      "linked",
      "cloud-browser",
      "data",
      "usage",
      "billing",
    ],
  );
});

test("Project and Work dynamic pickers retain ids, disabled state, placeholders and dependent resets", () => {
  const project = pickerElements("src/components/ChatProjectDialog.tsx");
  const work = pickerElements("src/components/WorkExecutionPanel.tsx");
  assert.equal(project.length, 1);
  assert.equal(work.length, 2);
  const changes = [];
  const projects = [{ id: "actual-project", name: "Same name" }];
  const base = { projects, projectId: "", setProjectId: (value) => changes.push(value) };
  const dialog = renderElement(project[0], {
    ...base,
    projectFieldId: "project-label",
    busy: true,
  });
  assert.equal(dialog.props.id, "project-label");
  assert.equal(dialog.props.disabled, true);
  assert.equal(dialog.props.placeholder, "Select a project");
  assert.equal(dialog.props.options[0].value, "actual-project");
  dialog.props.onValueChange("actual-project");
  const workProject = renderElement(work[0], { ...base, locked: true });
  assert.equal(workProject.props.disabled, true);
  assert.equal(workProject.props.placeholder, "Choose a Project");
  const history = renderElement(work[1], {
    selected: null,
    snapshot: {
      runs: [{ id: "run-id", request: { objective: "Do work" }, status: "awaiting_approval" }],
    },
    setSelected: (value) => changes.push(value),
    setText: (value) => changes.push(value),
  });
  assert.equal(history.props.options[0].value, "run-id");
  assert.equal(history.props.options[0].label, "Do work · awaiting approval");
  history.props.onValueChange("run-id");
  assert.deepEqual(changes, ["actual-project", "run-id", ""]);
  const execution = source("src/components/WorkExecutionPanel.tsx");
  assert.doesNotMatch(execution, /<select\b/);
  assert.equal((execution.match(/<SelectTrigger\b/g) ?? []).length, 2);
  assert.match(execution, /disabled=\{locked \|\| !modelOptions\.length\}/);
  assert.match(execution, /disabled=\{!option\.available\}/);
  assert.match(execution, /setMode\(value as WorkModelMode\);\s*setReasoningEffort\(null\)/);
  assert.match(
    execution,
    /locked \|\| !selectedModel\?\.available \|\| !selectedModel\.reasoningEfforts\.length/,
  );
});

test("Scheduled Task dynamic pickers preserve file additions, consent reset, grant invalidation and source ids", () => {
  const elements = pickerElements("src/components/ScheduledTaskEditor.tsx");
  assert.equal(elements.length, 4);
  const refs = [];
  const fileValues = {
    control: "field",
    options: [{ id: "file-id", label: "Notes", projectId: "project-id" }],
    refs,
    kind: "project_file",
    setRefs: (updater) => refs.push(...updater([])),
  };
  const file = renderElement(elements[0], fileValues);
  assert.equal(file.props.value, "");
  file.props.onValueChange("file-id");
  assert.equal(refs[0].kind, "project_file");
  assert.equal(refs[0].id, "file-id");
  assert.equal(refs[0].projectId, "project-id");
  const changes = [];
  const connections = [{ id: "connection-id", provider: "gmail", label: "Work account" }];
  const connection = renderElement(elements[1], {
    control: "field",
    connections,
    connectionId: "",
    setConnectionId: (value) => changes.push(["connection", value]),
    setConnectionConsent: (value) => changes.push(["consent", value]),
  });
  connection.props.onValueChange("connection-id");
  assert.deepEqual(changes, [
    ["connection", "connection-id"],
    ["consent", false],
  ]);
  const resourceRead = { current: 2 };
  const approval = renderElement(elements[2], {
    control: "field",
    resourceRead,
    connections,
    grants: [{ id: "grant-id", provider: "gmail", connection_ref: "connection-id" }],
    grantId: "",
    setGrantId: (value) => changes.push(["grant", value]),
    setResources: (value) => changes.push(["resources", value.length]),
    setResource: (value) => changes.push(["resource", value]),
    setResourceCursor: (value) => changes.push(["cursor", value]),
  });
  approval.props.onValueChange("grant-id");
  assert.equal(resourceRead.current, 3);
  assert.equal(approval.props.options[0].label, "gmail · Work account");
  assert.deepEqual(changes.slice(2), [
    ["grant", "grant-id"],
    ["resources", 0],
    ["resource", ""],
    ["cursor", null],
  ]);
  const resource = renderElement(elements[3], {
    control: "field",
    resource: "",
    resources: [{ id: "source-id", label: "Inbox" }],
    setResource: (value) => changes.push(["resource", value]),
  });
  resource.props.onValueChange("source-id");
  assert.deepEqual(changes.at(-1), ["resource", "source-id"]);
});

const branches = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `branch-${index}`,
    label: index < 2 ? "Duplicate" : null,
    branchFromMessageIndex: null,
    active: index === 0,
    createdAt: "2026-10-19T00:00:00Z",
    durable: index % 2 === 0,
  }));
function branchHarness(mobile, messages = []) {
  return harness("src/components/ChatBranchBar.tsx", "ChatBranchBar", {
    "@/components/ui/button": { Button: "button" },
    "@/hooks/use-mobile": { useLayout: () => ({ isMobile: mobile }) },
    sonner: {
      toast: {
        success: (message) => messages.push(message),
        error: (message) => messages.push(message),
      },
    },
  });
}

test("desktop and mobile branches search only above seven choices with original identities and active guards", () => {
  for (const mobile of [false, true]) {
    for (const count of [7, 8]) {
      const render = branchHarness(mobile);
      const records = branches(count);
      const tree = render({
        branches: records,
        activeBranch: { ...records[0] },
        onActivate: async () => {},
      });
      const lists = find(tree, "SearchablePickerList");
      assert.equal(lists.length, count > 7 ? 1 : 0);
      if (count > 7) {
        assert.equal(lists[0].props.options.length, count);
        assert.equal(lists[0].props.options[1].value, "branch-1");
        assert.equal(lists[0].props.options[0].disabled, true);
        assert.equal(lists[0].props.value, "branch-0");
        assert.equal(lists[0].props.options[2].label, "Branch 3");
      } else if (mobile) {
        assert.equal(find(tree, "Check").length, 1);
        assert.equal(find(tree, "ul")[0].props.role, "listbox");
      } else {
        assert.equal(find(tree, "DropdownMenuRadioGroup")[0].props.value, "branch-0");
        assert.equal(find(tree, "DropdownMenuRadioItem")[0].props.disabled, true);
      }
    }
  }
});

test("branch selection cannot activate a missing or active id or start a second pending operation", async () => {
  const messages = [];
  const render = branchHarness(true, messages);
  const calls = [];
  let finish;
  const props = {
    branches: branches(8),
    activeBranch: null,
    onActivate: (id) => {
      calls.push(id);
      return new Promise((resolve) => (finish = resolve));
    },
  };
  let tree = render(props);
  find(tree, "button")[0].props.onClick();
  tree = render(props);
  assert.equal(find(tree, "MobileBottomSheet")[0].props.open, true);
  const choose = find(tree, "SearchablePickerList")[0].props.onValueChange;
  choose("missing");
  choose("branch-0");
  choose("branch-1");
  choose("branch-2");
  assert.deepEqual(calls, ["branch-1"]);
  tree = render(props);
  assert.equal(find(tree, "SearchablePickerList")[0].props.disabled, true);
  assert.equal(find(tree, "MobileBottomSheet")[0].props.open, true);
  finish(true);
  await new Promise((resolve) => setImmediate(resolve));
  tree = render(props);
  assert.equal(find(tree, "SearchablePickerList")[0].props.disabled, false);
  assert.equal(find(tree, "MobileBottomSheet")[0].props.open, false);
  assert.deepEqual(messages, ["Switched branch"]);
});

test("branch failure keeps the sheet available, clears busy and permits an explicit retry", async () => {
  const messages = [];
  const render = branchHarness(true, messages);
  let attempts = 0;
  const props = {
    branches: branches(8),
    activeBranch: null,
    onActivate: async () => {
      if (++attempts === 1) throw "unavailable";
      return true;
    },
  };
  let tree = render(props);
  find(tree, "button")[0].props.onClick();
  tree = render(props);
  find(tree, "SearchablePickerList")[0].props.onValueChange("branch-1");
  await new Promise((resolve) => setImmediate(resolve));
  tree = render(props);
  assert.equal(find(tree, "MobileBottomSheet")[0].props.open, true);
  assert.equal(find(tree, "SearchablePickerList")[0].props.disabled, false);
  assert.deepEqual(messages, ["That branch could not be activated."]);
  find(tree, "SearchablePickerList")[0].props.onValueChange("branch-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(find(render(props), "MobileBottomSheet")[0].props.open, false);
  assert.equal(messages.at(-1), "Switched branch");
});

test("short mobile branch lists retain native Enter and support arrow/Home/End focus navigation", () => {
  const render = branchHarness(true);
  const tree = render({ branches: branches(3), activeBranch: null, onActivate: async () => {} });
  const list = find(tree, "ul")[0];
  const focused = [];
  const first = { focus: () => focused.push("first") };
  const last = { focus: () => focused.push("last") };
  const currentTarget = {
    querySelectorAll: (selector) => {
      assert.match(selector, /:not\(:disabled\)/);
      return [first, last];
    },
  };
  let prevented = 0;
  for (const key of ["ArrowDown", "ArrowUp", "End", "Home", "Enter"])
    list.props.onKeyDown({ key, currentTarget, target: first, preventDefault: () => prevented++ });
  assert.deepEqual(focused, ["last", "last", "last", "first"]);
  assert.equal(prevented, 4);
});

test("shared menu checkmarks preserve Radix radio semantics and item indicators", () => {
  for (const [path, prefix] of [
    ["dropdown-menu", "DropdownMenu"],
    ["context-menu", "ContextMenu"],
  ]) {
    const content = source(`src/components/ui/${path}.tsx`);
    const radio = content
      .split(`const ${prefix}RadioItem =`)[1]
      .split(`${prefix}RadioItem.displayName`)[0];
    assert.match(radio, new RegExp(`<${prefix}Primitive.RadioItem`));
    assert.match(radio, new RegExp(`<${prefix}Primitive.ItemIndicator>`));
    assert.match(radio, /<Check /);
    assert.doesNotMatch(content, /\bCircle\b/);
    assert.match(radio, /\.\.\.props/);
  }
});

test("searchable selectors retain the reference row density and coarse-pointer targets", () => {
  const command = source("src/components/ui/command.tsx");
  const picker = source(pickerPath);
  assert.match(command, /min-h-8/);
  assert.match(command, /rounded-xl/);
  assert.match(command, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.match(picker, /className="min-h-8 \[@media\(pointer:coarse\)\]:min-h-11"/);
  const css = source("src/styles/spec400-system.css");
  assert.doesNotMatch(css, /body \[role="option"\][^{]*\{[^}]*min-height:\s*44px/s);
});
