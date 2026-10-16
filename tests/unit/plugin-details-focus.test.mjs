import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadUiModule, jsxRuntime, elements, text } from "../helpers/ui-state-harness.mjs";
const source = readFileSync("src/routes/apps.tsx", "utf8");
const ast = ts.createSourceFile(
  "apps.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let onDetails, detailsButtonRef, onCloseAutoFocus, card;
const visit = (n) => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === "AppCard") card = n;
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === "AppCard")
    for (const p of n.attributes.properties) {
      if (p.name?.getText(ast) === "onDetails") onDetails = p.initializer.expression;
      if (p.name?.getText(ast) === "detailsButtonRef") detailsButtonRef = p.initializer.expression;
    }
  if (
    ts.isJsxOpeningElement(n) &&
    n.tagName.getText(ast) === "DialogContent" &&
    n.getText(ast).includes("detailsReturnRef")
  )
    onCloseAutoFocus = n.attributes.properties.find(
      (p) => p.name?.getText(ast) === "onCloseAutoFocus",
    ).initializer.expression;
  ts.forEachChild(n, visit);
};
visit(ast);
assert.ok(onDetails && detailsButtonRef && onCloseAutoFocus && card);
const run = (node, g) =>
  vm.runInNewContext(
    ts.transpileModule("(" + node.getText(ast) + ")", {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        jsxFactory: "createElement",
      },
    }).outputText,
    {
      ...g,
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    },
  );
function fixture() {
  const focused = [],
    win = { location: { href: "http://local/apps" } },
    buttons = new Map(),
    g = {
      window: win,
      item: { id: "gmail" },
      principal: "alice",
      principalRef: { current: "alice" },
      generationRef: { current: 3 },
      detailsReturnRef: { current: null },
      detailsButtonsRef: { current: buttons },
      setSelectedApp(item) {
        g.selected = item;
      },
    };
  g.restoreDialogFocus = loadUiModule(
    "src/lib/dialog-return-focus.ts",
    {},
    { window: win },
  ).restoreDialogFocus;
  const target = (id) => ({
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused.push(id),
  });
  return {
    g,
    focused,
    target,
    register: run(detailsButtonRef, g),
    open: run(onDetails, g),
    close: run(onCloseAutoFocus, g),
  };
}
test("Details close returns exact provider button even after the card remounts", () => {
  const f = fixture();
  f.register(f.target("original"));
  f.open();
  assert.equal(f.g.selected.id, "gmail");
  f.register(null);
  f.register(f.target("current gmail"));
  f.g.detailsButtonsRef.current.set("github", f.target("github"));
  f.close({ preventDefault() {} });
  assert.deepEqual(f.focused, ["current gmail"]);
  assert.equal(f.g.detailsReturnRef.current, null);
});
for (const reason of ["URL", "principal", "generation", "removed", "hidden", "programmatic"])
  test(`Details return focus skips ${reason} change`, () => {
    const f = fixture(),
      target = f.target("gmail");
    f.register(target);
    if (reason !== "programmatic") f.open();
    if (reason === "URL") f.g.window.location.href = "http://local/chat";
    if (reason === "principal") f.g.principalRef.current = "bob";
    if (reason === "generation") f.g.generationRef.current++;
    if (reason === "removed") f.register(null);
    if (reason === "hidden") target.getClientRects = () => [];
    f.close({ preventDefault() {} });
    assert.equal(f.focused.length, 0);
    assert.equal(f.g.detailsReturnRef.current, null);
  });
test("actual provider Details button registers its DOM ref and opens only Details", () => {
  const fn = run(card, {
    require: () => jsxRuntime,
    PluginLogo: "PluginLogo",
    StatusBadge: "StatusBadge",
    connectorConnectFlow: () => null,
    connectorUnavailableReason: () => "Unavailable",
  });
  let registered,
    opened = 0;
  const node = {};
  const tree = fn({
    item: { id: "gmail", label: "Gmail" },
    state: "idle",
    configured: false,
    isSignedIn: true,
    detailsButtonRef: (x) => (registered = x),
    onDetails: () => opened++,
    onConnect() {
      throw new Error("connect must not run");
    },
    onDisconnect() {
      throw new Error("disconnect must not run");
    },
    onRetry() {},
    onUseInChat() {},
  });
  const details = elements(tree, (n) => n.type === "button" && text(n).trim() === "Details")[0];
  details.props.ref(node);
  details.props.onClick();
  assert.equal(registered, node);
  assert.equal(opened, 1);
});
