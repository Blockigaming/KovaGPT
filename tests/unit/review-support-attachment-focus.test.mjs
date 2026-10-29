import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("review-kit/components/SupportRequestPreview.tsx", "utf8");
const parsed = ts.createSourceFile(
  "support.tsx",
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
visit(parsed);
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
const click = nodes
  .find(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === "onClick" &&
      node.getText(parsed).includes("removeFocusRef.current"),
  )
  .initializer.expression.getText(parsed);
const effect = nodes
  .find(
    (node) => ts.isCallExpression(node) && node.expression.getText(parsed) === "useLayoutEffect",
  )
  .arguments[0].getText(parsed);
function fixture() {
  const focused = [],
    actions = [];
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused.push("attachment input"),
  };
  const window = { location: { href: "https://local.invalid/core-preview" } };
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const deps = {
    window,
    document,
    attachmentInputRef: { current: target },
    removeFocusRef: { current: null },
    state: { stage: "editing" },
    busy: false,
    file: { name: "sample.txt" },
    attachmentKey: (file) => file.name,
    dispatch: (action) => actions.push(action),
  };
  deps.restoreDialogFocus = compile(
    `${readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export function/gm, "function")}; return restoreDialogFocus;`,
    { window },
  );
  return {
    deps,
    focused,
    actions,
    target,
    remove() {
      compile(`return (${click});`, deps)({ currentTarget: {} });
    },
    commit() {
      compile(`return (${effect});`, deps)();
    },
  };
}
test("attachment removal focuses the file picker once after the row disappears", () => {
  const f = fixture();
  f.remove();
  assert.deepEqual(f.actions, [{ type: "remove", key: "sample.txt" }]);
  f.commit();
  f.commit();
  assert.deepEqual(f.focused, ["attachment input"]);
  assert.match(source, /id="preview-support-files"\s+ref=\{attachmentInputRef\}/);
});
test("attachment focus restoration respects later focus, navigation, sending and unavailable targets", () => {
  const initial = fixture();
  initial.commit();
  assert.deepEqual(initial.focused, []);
  const busy = fixture();
  busy.deps.busy = true;
  busy.remove();
  busy.commit();
  assert.deepEqual(busy.actions, []);
  assert.deepEqual(busy.focused, []);
  for (const change of [
    (f) => (f.deps.state.stage = "sending"),
    (f) => (f.deps.window.location.href += "?other"),
    (f) => (f.deps.document.activeElement = {}),
    (f) => (f.target.isConnected = false),
    (f) => (f.target.getClientRects = () => []),
  ]) {
    const f = fixture();
    f.remove();
    change(f);
    f.commit();
    assert.deepEqual(f.focused, []);
    assert.equal(f.deps.removeFocusRef.current, null);
  }
});
