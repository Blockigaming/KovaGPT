import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("review-kit/components/BillingManagementPreview.tsx", "utf8");
const parsed = ts.createSourceFile(
  "billing.tsx",
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
const handler = (name) =>
  nodes
    .find((node) => ts.isJsxAttribute(node) && node.name.getText(parsed) === name)
    .initializer.expression.getText(parsed);
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
test("billing opener is wired and dismiss restores only a visible same-page invoker", () => {
  const core = readFileSync("review-kit/core-preview.tsx", "utf8");
  assert.match(core, /<button\s+ref=\{openerRef\}/);
  assert.match(core, /<BillingManagementPreview[^>]+returnFocusRef=\{openerRef\}/);
  for (const change of ["none", "navigate", "disconnected", "laterFocus", "hidden", "missing"]) {
    const focused = [];
    const target = {
      isConnected: true,
      getClientRects: () => [{}],
      closest: () => null,
      matches: () => false,
      focus: () => focused.push("opener"),
    };
    const window = { location: { href: "https://local.invalid/core-preview" } };
    const document = { body: {}, activeElement: null };
    document.activeElement = document.body;
    const deps = {
      window,
      document,
      openingUrlRef: { current: undefined },
      returnFocusRef: { current: target },
      contentRef: { current: null },
    };
    deps.restoreDialogFocus = compile(
      `${readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export function/gm, "function")}; return restoreDialogFocus;`,
      { window },
    );
    compile(`return (${handler("onOpenAutoFocus")});`, deps)();
    if (change === "navigate") window.location.href += "?other";
    if (change === "disconnected") target.isConnected = false;
    if (change === "laterFocus") document.activeElement = {};
    if (change === "hidden") target.getClientRects = () => [];
    if (change === "missing") deps.returnFocusRef.current = null;
    let prevented = false;
    compile(
      `return (${handler("onCloseAutoFocus")});`,
      deps,
    )({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.deepEqual(focused, change === "none" ? ["opener"] : []);
  }
});
