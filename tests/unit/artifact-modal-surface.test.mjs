import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import postcss from "postcss";
import vm from "node:vm";
import { createHookHarness, loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
function initializer(source, name) {
  const ast = ts.createSourceFile(
    "editor.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let result;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) result = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.ok(result);
  return result.getText(ast);
}
function fixture(presentation = "dialog", dirty = false, allow = false) {
  const hooks = createHookHarness();
  let closed = 0,
    confirmed = 0,
    focused = 0,
    restored = 0;
  const globals = {
    useCallback: (fn) => fn,
    hasUnsavedDraft: dirty,
    window: {
      confirm: () => {
        confirmed++;
        return allow;
      },
    },
    onClose: () => closed++,
  };
  const run = (s) =>
    vm.runInNewContext(
      ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      globals,
    );
  globals.approveClose = run("(" + initializer(editor, "approveClose") + ")");
  const requestClose = run("(" + initializer(editor, "requestClose") + ")");
  class Element {
    isConnected = true;
    getClientRects() {
      return [{}];
    }
    closest() {
      return null;
    }
    matches() {
      return false;
    }
    focus() {
      restored++;
    }
  }
  const target = new Element(),
    win = { location: { href: "http://local/chat" } },
    document = { activeElement: target };
  const m = loadUiModule(
    "src/components/ArtifactEditorSurface.tsx",
    {
      react: hooks.react,
      "@radix-ui/react-dialog": Object.fromEntries(
        ["Root", "Portal", "Overlay", "Content", "Title"].map((n) => [n, n]),
      ),
      "@/lib/dialog-return-focus": loadUiModule(
        "src/lib/dialog-return-focus.ts",
        {},
        { window: win },
      ),
    },
    { window: win, document, HTMLElement: Element },
  );
  const tree = hooks.render(m.ArtifactEditorSurface, {
    presentation,
    label: "Code",
    onRequestClose: requestClose,
    children: { type: "textarea", props: { value: "Unsaved code draft" } },
  });
  const content = elements(tree, (n) => n.type === "Content")[0];
  if (content)
    content.props.ref.current = {
      focus() {
        focused++;
      },
    };
  return {
    tree,
    content,
    win,
    target,
    requestClose,
    state: () => ({ closed, confirmed, focused, restored }),
  };
}
test("dialog is a controlled modal within a body portal, with a title and focus on the surface", () => {
  const f = fixture();
  assert.equal(f.tree.type, "Root");
  assert.equal(f.tree.props.open, true);
  assert.equal(f.tree.props.modal, true);
  assert.equal(f.content.props["aria-modal"], "true");
  assert.equal(f.content.props.tabIndex, -1);
  const portal = elements(f.tree, (n) => n.type === "Portal")[0];
  assert.ok(portal);
  assert.equal(portal.props.container, undefined);
  assert.ok(elements(portal, (n) => n.type === "Overlay").length);
  assert.match(text(elements(portal, (n) => n.type === "Title")[0]), /Code\s+editor/);
  f.content.props.onOpenAutoFocus({ preventDefault() {} });
  assert.equal(f.state().focused, 1);
  f.content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.state().restored, 1);
});
for (const action of ["Escape", "backdrop", "Close", "Radix dismissal"])
  for (const allow of [false, true])
    test(`dirty ${action}: ${allow ? "confirmed exit" : "cancel retains mounted draft"}`, () => {
      const f = fixture("dialog", true, allow);
      const event = {
        preventDefault() {},
        detail: { originalEvent: { button: 0, ctrlKey: false } },
      };
      if (action === "Escape") f.content.props.onEscapeKeyDown(event);
      else if (action === "backdrop") f.content.props.onPointerDownOutside(event);
      else if (action === "Close") f.requestClose();
      else f.tree.props.onOpenChange(false);
      assert.equal(f.state().confirmed, 1);
      assert.equal(f.state().closed, allow ? 1 : 0);
      assert.equal(
        elements(f.tree, (n) => n.type === "textarea")[0].props.value,
        "Unsaved code draft",
      );
      assert.equal(f.tree.props.open, true);
    });
test("clean dismissal does not confirm; right-click backdrop does not close", () => {
  const f = fixture();
  f.content.props.onPointerDownOutside({
    preventDefault() {},
    detail: { originalEvent: { button: 2, ctrlKey: false } },
  });
  assert.equal(f.state().closed, 0);
  f.content.props.onEscapeKeyDown({ preventDefault() {} });
  assert.equal(f.state().closed, 1);
  assert.equal(f.state().confirmed, 0);
});
test("navigation or detached invoker skips restoration", () => {
  for (const reason of ["navigation", "detached"]) {
    const f = fixture();
    f.content.props.onOpenAutoFocus({ preventDefault() {} });
    if (reason === "navigation") f.win.location.href = "http://local/page";
    else f.target.isConnected = false;
    f.content.props.onCloseAutoFocus({ preventDefault() {} });
    assert.equal(f.state().restored, 0);
  }
});
test("page presentation remains inline main without dialog/portal and preserves children", () => {
  const f = fixture("page");
  assert.equal(
    elements(f.tree, (n) => ["Root", "Portal", "Content", "Overlay"].includes(n.type)).length,
    0,
  );
  const main = elements(f.tree, (n) => n.props?.role === "main")[0];
  assert.equal(main.props.id, "main-content");
  assert.equal(main.props.tabIndex, -1);
  assert.equal(elements(main, (n) => n.type === "textarea")[0].props.value, "Unsaved code draft");
});
test("dirty-work approval/save/improve contracts unchanged from exact base; only page keeps window Escape", () => {
  const base = execFileSync(
    "git",
    ["show", "4381048ed5d1eee2b198f2489e9b6bb756a706f4:src/components/ArtifactEditor.tsx"],
    { encoding: "utf8" },
  );
  for (const name of ["hasUnsavedDraft", "approveClose", "requestClose", "save", "improve"])
    assert.equal(initializer(editor, name), initializer(base, name), name);
  assert.match(editor, /if \(!open \|\| presentation !== "page"\) return;\s+const onKey/);
  const baselineStyle = execFileSync(
    "git",
    ["show", "4381048ed5d1eee2b198f2489e9b6bb756a706f4:src/styles.css"],
    { encoding: "utf8" },
  );
  const messageRules = (css) => {
    const rules = [];
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector.includes(".kova-message")) rules.push(rule.toString());
    });
    return rules;
  };
  assert.deepEqual(
    messageRules(readFileSync("src/styles.css", "utf8")),
    messageRules(baselineStyle),
  );
});
