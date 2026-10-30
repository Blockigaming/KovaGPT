import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { settle } from "../helpers/ui-state-harness.mjs";
const source = readFileSync("src/routes/library.tsx", "utf8");
const file = ts.createSourceFile(
  "library.tsx",
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
function handler(name, marker) {
  const found = nodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === name &&
      node.getText(file).includes(marker),
  );
  assert.equal(found.length, 1);
  return found[0].initializer.expression.getText(file);
}
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
function fixture() {
  const focus = [],
    calls = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    matches() {
      return !!this.disabled;
    }
    closest() {
      return this.inert ? {} : null;
    }
    contains(other) {
      return this.child === other;
    }
    focus() {
      focus.push(this.name);
      document.activeElement = this;
    }
  }
  const window = { location: { href: "https://kova.test/library" } },
    document = { body: new Element("body"), activeElement: null };
  document.activeElement = document.body;
  const trigger = new Element("Actions for Research"),
    fallback = new Element("Search Library"),
    item = { id: "item", title: "Research" };
  const deps = {
    window,
    document,
    HTMLElement: Element,
    item,
    principalReady: true,
    principal: "A",
    principalRef: { current: "A" },
    libraryCleared: false,
    lifecycleGenerationRef: { current: 1 },
    versionReturnFocusRef: { current: null },
    versionMenuHandoffRef: { current: new Set() },
    renameMenuHandoffRef: { current: new Set() },
    deleteMenuHandoffRef: { current: new Set() },
    deleteActionButtonsRef: { current: new Map([[item.id, trigger]]) },
    librarySearchRef: { current: fallback },
    libraryRootRef: { current: new Element("Library") },
    setVersionItem: (value) => calls.push(["version", value]),
    setPreviewItem: (value) => calls.push(["preview", value]),
    load: () => calls.push(["load"]),
    withItem: async (value, action) => action(value),
    restoreDialogFocus: compile(
      readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
        /^export function/gm,
        "function",
      ) + "; return restoreDialogFocus;",
      { window },
    ),
  };
  const run = (name, marker, event = { preventDefault() {}, target: new Element("dialog") }) =>
    compile(`return (${handler(name, marker)});`, deps)(event);
  return {
    deps,
    focus,
    calls,
    trigger,
    fallback,
    Element,
    run,
    async open() {
      run("onClick", "versionMenuHandoffRef");
      await settle();
    },
    close() {
      run("onCloseAutoFocus", "const origin = versionReturnFocusRef.current");
    },
  };
}
test("Versions captures exact Actions invoker and hands off menu focus once", async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.deps.versionReturnFocusRef.current.trigger, f.trigger);
  assert.equal(f.calls[0][0], "version");
  let prevented = 0;
  const event = {
    preventDefault() {
      prevented++;
    },
  };
  f.run("onCloseAutoFocus", "deleteMenuHandoffRef", event);
  f.run("onCloseAutoFocus", "deleteMenuHandoffRef", event);
  assert.equal(prevented, 1);
  f.close();
  assert.deepEqual(f.focus, ["Actions for Research"]);
  assert.equal(f.deps.versionReturnFocusRef.current, null);
});
for (const targetState of ["removed", "hidden", "disabled", "inert"])
  test(`Versions closes to stable fallback when its invoker is ${targetState}`, async () => {
    const f = fixture();
    await f.open();
    if (targetState === "removed") f.trigger.isConnected = false;
    else f.trigger[targetState] = true;
    f.close();
    assert.deepEqual(f.focus, ["Search Library"]);
  });
for (const change of ["account", "reset", "unmount", "navigation", "later-focus", "cleared"])
  test(`Versions close does not move focus after ${change}`, async () => {
    const f = fixture();
    await f.open();
    if (change === "account") f.deps.principalRef.current = "B";
    if (change === "reset" || change === "unmount") f.deps.lifecycleGenerationRef.current++;
    if (change === "navigation") f.deps.window.location.href += "?changed";
    if (change === "later-focus") f.deps.document.activeElement = new f.Element("later");
    if (change === "cleared") f.deps.libraryCleared = true;
    f.close();
    assert.deepEqual(f.focus, []);
  });
test("successful replacement closes and refreshes, then focuses a stable fallback if reload detached the row", async () => {
  const f = fixture();
  await f.open();
  f.deps.load = () => {
    f.trigger.isConnected = false;
    f.calls.push(["load"]);
  };
  f.run("onUpdated", "setVersionItem");
  f.close();
  assert.deepEqual(f.calls.slice(-3), [["version", null], ["preview", null], ["load"]]);
  assert.deepEqual(f.focus, ["Search Library"]);
});
test("failed asynchronous item opening returns menu focus without opening Versions", async () => {
  const f = fixture();
  f.deps.withItem = async () => {};
  await f.open();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.focus, ["Actions for Research"]);
});
test("failed item opening cannot steal later focus or restore another account's invoker", async () => {
  for (const change of ["later", "account", "reset"]) {
    const f = fixture();
    f.deps.withItem = async () => {
      if (change === "later") f.deps.document.activeElement = new f.Element("later");
      else if (change === "account") f.deps.principalRef.current = "B";
      else f.deps.lifecycleGenerationRef.current++;
    };
    await f.open();
    assert.deepEqual(f.focus, []);
  }
});

test("fast failed Versions opening releases the pending menu handoff for normal close focus", async () => {
  const f = fixture();
  f.deps.withItem = async () => {};
  await f.open();
  let prevented = false;
  f.run("onCloseAutoFocus", "deleteMenuHandoffRef", {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
});
