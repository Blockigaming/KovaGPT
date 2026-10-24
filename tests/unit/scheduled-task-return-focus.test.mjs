import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the route's real callbacks with explicit DOM doubles. This is not browser evidence.
const source = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
const parsed = ts.createSourceFile(
  "tasks.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
const compile = (code, dependencies) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(dependencies));
const variable = (name) =>
  nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
const attribute = (tag, name, includes = "") => {
  const matches = nodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.parent.parent.tagName.getText(parsed) === tag &&
      node.parent.parent.getText(parsed).includes(includes),
  );
  assert.equal(matches.length, 1, `${tag}.${name}: ${includes}`);
  return matches[0].initializer.expression.getText(parsed);
};

function fixture() {
  const focused = [];
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  class Element {
    constructor(name, parent = null) {
      this.name = name;
      this.parent = parent;
      this.isConnected = true;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return Boolean(this.disabled);
    }
    contains(element) {
      return element === this || element?.parent === this;
    }
    focus(options) {
      focused.push([this.name, options]);
      document.activeElement = this;
    }
  }
  const trigger = new Element("trigger");
  const menuTrigger = new Element("more-actions");
  const heading = new Element("page-heading");
  const dialog = new Element("dialog");
  const input = new Element("title-input", dialog);
  const t = { id: "task-a", title: "Existing task" };
  const window = { location: { href: "https://local.invalid/scheduled-tasks" } };
  const editorReturnRef = { current: null };
  const dependencies = {
    window,
    document,
    HTMLElement: Element,
    editorReturnRef,
    deleteReturnRef: { current: null },
    actionFocusRef: { current: new Map() },
    taskMenuActionsRef: { current: new Set() },
    principal: "user:a",
    principalRef: { current: "user:a" },
    generationRef: { current: 1 },
    dataGeneration: 1,
    dataReady: true,
    pageHeadingRef: { current: heading },
    refreshButtonRef: { current: null },
    taskActionButtonsRef: { current: new Map([[t.id, menuTrigger]]) },
    t,
    createdTask: t,
    setEditor(value) {
      dependencies.editor = value;
    },
    setEditorSection(value) {
      dependencies.section = value;
    },
    restoreDialogFocus: compile(
      readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
        "export function",
        "function",
      ) + "; return restoreDialogFocus;",
      { window },
    ),
  };
  dependencies.openTaskEditor = compile(
    `return (${variable("openTaskEditor").initializer.arguments[0].getText(parsed)});`,
    dependencies,
  );
  const run = (code, args) => compile(`return (${code});`, dependencies)(args);
  const closeHandler = () =>
    compile(`return (${attribute("ScheduledTaskEditor", "onCloseAutoFocus")});`, {
      ...dependencies,
      editorFocusOrigin: editorReturnRef.current,
    });
  const close = (callback = closeHandler()) => {
    let prevented = false;
    callback({
      target: dialog,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(
      prevented,
      true,
      "Radix's default restoration must not overwrite the page's target",
    );
  };
  return {
    ...dependencies,
    dependencies,
    focused,
    trigger,
    menuTrigger,
    heading,
    dialog,
    input,
    close,
    closeHandler,
    openButton(kind) {
      run(
        attribute(
          "button",
          "onClick",
          {
            title: "spec400-task-title",
            new: "spec400-primary",
            receipt: "spec400-created-receipt",
          }[kind],
        ),
        { currentTarget: trigger },
      );
    },
    openMenu(label) {
      const item = nodes.find(
        (node) =>
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(parsed) === "DropdownMenuItem" &&
          node.children.some((child) => ts.isJsxText(child) && child.text.trim() === label),
      );
      assert.ok(item);
      const select = item.openingElement.attributes.properties.find(
        (node) => node.name?.getText(parsed) === "onSelect",
      );
      run(select.initializer.expression.getText(parsed));
    },
    menuClose() {
      let prevented = false;
      run(attribute("DropdownMenuContent", "onCloseAutoFocus"), {
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test("title, New, and creation-receipt clicks restore their exact captured source after dialog focus", () => {
  for (const kind of ["title", "new", "receipt"]) {
    const f = fixture();
    // Pointer opening need not have focused the trigger before the dialog mounted.
    f.openButton(kind);
    assert.equal(f.editorReturnRef.current.trigger, f.trigger);
    assert.equal(f.dependencies.editor, kind === "new" ? "new" : f.t);
    assert.equal(f.dependencies.section, "settings");
    f.document.activeElement = f.input;
    f.close();
    assert.deepEqual(f.focused, [["trigger", { preventScroll: true }]]);
    assert.equal(f.editorReturnRef.current, null);
  }
});

test("Open, Edit, and View runs restore the persistent menu trigger instead of an unmounted menu item", () => {
  for (const label of ["Open", "Edit", "View runs"]) {
    const f = fixture();
    assert.equal(f.menuClose(), false);
    f.openMenu(label);
    assert.equal(f.editorReturnRef.current.trigger, f.menuTrigger);
    assert.equal(f.dependencies.section, label === "View runs" ? "history" : "settings");
    assert.equal(
      f.menuClose(),
      true,
      "closing the source menu must leave the new dialog's focus alone",
    );
    f.document.activeElement = f.document.body;
    f.close();
    assert.deepEqual(f.focused, [["more-actions", { preventScroll: true }]]);
    assert.equal(f.menuClose(), false);
  }
});

test("missing, disconnected, hidden, inert, or disabled openers use the stable heading", () => {
  for (const state of ["missing", "removed", "hidden", "inert", "disabled"]) {
    const f = fixture();
    f.openButton("title");
    if (state === "missing") f.editorReturnRef.current.trigger = null;
    else if (state === "removed") f.trigger.isConnected = false;
    else f.trigger[state] = true;
    f.close();
    assert.deepEqual(f.focused, [["page-heading", { preventScroll: true }]]);
  }
  assert.match(source, /<h1[^>]*ref=\{pageHeadingRef\}[^>]*tabIndex=\{-1\}/);
});

test("deep-linked editors deliberately use the page heading without capturing an unrelated input", () => {
  const f = fixture();
  const effect = nodes.find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0]?.getText(parsed).includes("const selected = tasks.find"),
  );
  compile(`return (${effect.arguments[0].getText(parsed)});`, {
    ...f.dependencies,
    requestedTaskId: f.t.id,
    loading: false,
    taskListLoaded: { current: true },
    openedTaskLink: { current: null },
    tasks: [f.t],
    setTaskLinkError() {},
  })();
  assert.equal(f.editorReturnRef.current.trigger, null);
  f.close();
  assert.deepEqual(f.focused, [["page-heading", { preventScroll: true }]]);
});

test("dismissal cannot override newer focus, navigation, account changes, resets, or unmount", () => {
  for (const change of [
    (f) => {
      f.document.activeElement = f.heading;
    },
    (f) => {
      f.window.location.href += "?other";
    },
    (f) => {
      f.principalRef.current = "user:b";
    },
    (f) => {
      f.generationRef.current++;
    },
    (f) => {
      f.editorReturnRef.current = null;
    },
    (f) => {
      f.trigger.isConnected = false;
      f.heading.isConnected = false;
    },
    (f) => {
      f.trigger.isConnected = false;
      f.heading.inert = true;
    },
  ]) {
    const f = fixture();
    f.openButton("title");
    const close = f.closeHandler();
    change(f);
    f.close(close);
    assert.deepEqual(f.focused, []);
  }
  assert.match(source, /generationRef.current \+= 1;\s*editorReturnRef.current = null/);
});

test("an old editor's close event cannot consume the next editor's focus context", () => {
  const f = fixture();
  f.openButton("title");
  const oldClose = f.closeHandler();
  f.openMenu("View runs");
  const current = f.editorReturnRef.current;
  f.close(oldClose);
  assert.equal(f.editorReturnRef.current, current);
  assert.deepEqual(f.focused, []);
  f.close();
  assert.deepEqual(f.focused, [["more-actions", { preventScroll: true }]]);
});

test("opening against an invalidated lifetime cannot replace the editor or return context", () => {
  const f = fixture();
  f.generationRef.current++;
  f.openButton("title");
  assert.equal(f.editorReturnRef.current, null);
  assert.equal(f.dependencies.editor, undefined);
});
