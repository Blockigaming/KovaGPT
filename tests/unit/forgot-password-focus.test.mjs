import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { loadUiModule, createHookHarness, elements } from "../helpers/ui-state-harness.mjs";
const dialogPath = "src/components/auth/ForgotPasswordDialog.tsx";
const source = readFileSync("src/routes/auth.tsx", "utf8");
const ast = ts.createSourceFile(
  "auth.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let opener, invocation;
const visit = (n) => {
  if (
    ts.isJsxElement(n) &&
    n.openingElement.tagName.getText(ast) === "button" &&
    n.getText(ast).includes("Forgot password?")
  )
    opener = n.openingElement.attributes.properties.find((p) => p.name?.getText(ast) === "onClick")
      .initializer.expression;
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === "ForgotPasswordDialog")
    invocation = n;
  ts.forEachChild(n, visit);
};
visit(ast);
assert.ok(opener && invocation);
function fixture() {
  let opened = false,
    focused = 0,
    requests = 0;
  const changes = [];
  const win = { location: { href: "http://local/auth?mode=sign-in", origin: "http://local" } };
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused++,
  };
  const refs = {
    forgotReturnFocusRef: { current: null },
    forgotReturnUrlRef: { current: undefined },
  };
  const open = vm.runInNewContext(
    ts.transpileModule("(" + opener.getText(ast) + ")", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { ...refs, window: win, setForgotOpen: (x) => (opened = x) },
  );
  open({ currentTarget: target });
  assert.equal(opened, true);
  const props = { open: true, onOpenChange: (x) => changes.push(x), initialEmail: "" };
  for (const name of ["returnFocusTarget", "returnFocusUrl"]) {
    const expression = invocation.attributes.properties.find((p) => p.name?.getText(ast) === name)
      .initializer.expression;
    props[name] = vm.runInNewContext(expression.getText(ast), refs);
  }
  const hooks = createHookHarness(),
    deny = () => {
      requests++;
      throw new Error("No auth request allowed in focus tests");
    };
  const { ForgotPasswordDialog } = loadUiModule(
    dialogPath,
    {
      react: hooks.react,
      "@/lib/dialog-return-focus": loadUiModule(
        "src/lib/dialog-return-focus.ts",
        {},
        { window: win },
      ),
      "@/components/ui/dialog": Object.fromEntries(
        ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"].map((n) => [
          n,
          n,
        ]),
      ),
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/label": { Label: "Label" },
      "@/components/ui/button": { Button: "Button" },
      "@/integrations/supabase/client": { supabase: { auth: { resetPasswordForEmail: deny } } },
      sonner: { toast: { error: deny } },
      "lucide-react": Object.fromEntries(["Loader2", "KeyRound", "Mail"].map((n) => [n, n])),
      "@/lib/kova-auth-browser": { browserKovaAuthEnabled: () => true, kovaPublicAuthJson: deny },
    },
    { window: win },
  );
  const tree = hooks.render(ForgotPasswordDialog, props);
  return {
    tree,
    win,
    target,
    changes,
    state: () => ({ focused, requests }),
    close: () =>
      elements(tree, (n) => n.type === "DialogContent")[0].props.onCloseAutoFocus({
        preventDefault() {},
      }),
  };
}
for (const method of ["Escape", "X", "backdrop"])
  test(`Forgot Password ${method} dismissal returns exact invoker without auth requests`, () => {
    const f = fixture();
    elements(f.tree, (n) => n.type === "Dialog")[0].props.onOpenChange(false);
    f.close();
    assert.deepEqual(f.changes, [false]);
    assert.deepEqual(f.state(), { focused: 1, requests: 0 });
  });
for (const reason of ["navigation", "detached", "hidden", "inert"])
  test(`Forgot Password restoration skips ${reason}`, () => {
    const f = fixture();
    if (reason === "navigation") f.win.location.href = "http://local/";
    if (reason === "detached") f.target.isConnected = false;
    if (reason === "hidden") f.target.getClientRects = () => [];
    if (reason === "inert") f.target.closest = () => ({});
    f.close();
    assert.deepEqual(f.state(), { focused: 0, requests: 0 });
  });
test("reset submission/validation/cooldown callback is unchanged from exact base", () => {
  const prior = execFileSync(
    "git",
    ["show", "2f82fc31e6e10b1a117f06fb842eb0daec0f6f0e:" + dialogPath],
    { encoding: "utf8" },
  );
  const submit = (source) => {
    const file = ts.createSourceFile(
      "dialog.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let result;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && n.name.getText(file) === "submit")
        result = n.initializer.getText(file);
      ts.forEachChild(n, visit);
    };
    visit(file);
    return result;
  };
  assert.equal(submit(readFileSync(dialogPath, "utf8")), submit(prior));
});
