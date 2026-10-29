import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("review-kit/components/SharedConversationPreview.tsx", "utf8");
const parsed = ts.createSourceFile(
  "shared.tsx",
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
      node.getText(parsed).includes("retryFocusRef.current"),
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
    focus: () => focused.push("viewer heading"),
  };
  const window = { location: { href: "https://local.invalid/core-preview" } };
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const deps = {
    window,
    document,
    viewerHeadingRef: { current: target },
    retryFocusRef: { current: null },
    state: { mode: "available" },
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
    retry() {
      compile(`return (${click});`, deps)({ currentTarget: {} });
    },
    commit() {
      compile(`return (${effect});`, deps)();
    },
  };
}
test("simulated retry focuses the restored sample heading once after commit", () => {
  const f = fixture();
  f.retry();
  assert.deepEqual(f.actions, [{ type: "mode", mode: "available" }]);
  assert.deepEqual(f.focused, []);
  f.commit();
  f.commit();
  assert.deepEqual(f.focused, ["viewer heading"]);
  assert.match(source, /<h3 ref=\{viewerHeadingRef\} tabIndex=\{-1\}/);
});
test("ordinary state changes do not move focus, and retry respects navigation and later focus", () => {
  const initial = fixture();
  initial.commit();
  assert.deepEqual(initial.focused, []);
  for (const change of [
    (f) => (f.deps.state.mode = "private"),
    (f) => (f.deps.window.location.href += "?other"),
    (f) => (f.deps.document.activeElement = {}),
    (f) => (f.target.isConnected = false),
    (f) => (f.target.getClientRects = () => []),
  ]) {
    const f = fixture();
    f.retry();
    change(f);
    f.commit();
    assert.deepEqual(f.focused, []);
    assert.equal(f.deps.retryFocusRef.current, null);
  }
});
