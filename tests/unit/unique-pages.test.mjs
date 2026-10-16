import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { jsxContract } from "../helpers/jsx-contract.mjs";
import vm from "node:vm";
import { loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
const base = "337e55a8c0de16e1a3180430a054b431aa4d6f1b",
  read = (p) => readFileSync(p, "utf8"),
  old = (p) => execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
function ast(s) {
  return ts.createSourceFile("file.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function normalize(s, divMain = false, presentationOnly = false) {
  if (divMain) s = s.replaceAll("<main", "<div").replaceAll("</main>", "</div>");
  const a = ast(s),
    t = ts.transform(a, [
      (ctx) => (root) =>
        ts.visitNode(root, function visit(n) {
          if (ts.isJsxAttribute(n) && ["className", "id", "tabIndex"].includes(n.name.getText(a)))
            return undefined;
          return ts.visitEachChild(n, visit, ctx);
        }),
    ]);
  if (presentationOnly) return jsxContract(ts.createPrinter().printFile(t.transformed[0]));
  return ts.transpileModule(ts.createPrinter().printFile(t.transformed[0]), {
    compilerOptions: { jsx: ts.JsxEmit.React },
  }).outputText;
}
for (const route of ["notifications", "trusted-contacts", "audit-log"])
  test(`${route} only gains semantic target/presentation; data and permission logic unchanged`, () => {
    const p = `src/routes/${route}.tsx`,
      s = read(p);
    assert.equal(
      normalize(
        route === "notifications" ? s.replace("<AppShell utilitiesInHeader>", "<AppShell>") : s,
        route === "audit-log",
      ),
      normalize(old(p)),
    );
    const mains = [...s.matchAll(/<main\b[^>]*>/g)];
    assert.equal(mains.length, route === "audit-log" ? 2 : 1);
    for (const [main] of mains) {
      assert.match(main, /id="main-content"/);
      assert.match(main, /tabIndex=\{-1\}/);
    }
    if (route === "trusted-contacts") assert.match(s, /kova-workspace-controls/);
  });
const source = read("src/routes/write.tsx");
function variable(s, name) {
  const a = ast(s);
  let value;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(a) === name)
      value = n.initializer?.getText(a);
    ts.forEachChild(n, visit);
  }
  visit(a);
  return value;
}
test("Write clear/save/draft effects and all existing top-level initializers unchanged", () => {
  const before = old("src/routes/write.tsx"),
    a = ast(before);
  let fn;
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "WritePage") fn = n;
    ts.forEachChild(n, visit);
  }
  visit(a);
  for (const statement of fn.body.statements)
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations) {
        const name = d.name.getText(a);
        assert.equal(variable(source, name), d.initializer?.getText(a), name);
      }
  const effects = (s) => {
    const a = ast(s),
      out = [];
    function visit(n) {
      if (ts.isCallExpression(n) && n.expression.getText(a) === "useEffect") out.push(n.getText(a));
      ts.forEachChild(n, visit);
    }
    visit(a);
    return out;
  };
  assert.deepEqual(effects(source), effects(before));
  assert.match(source, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  assert.equal((source.match(/id="main-content"/g) || []).length, 1);
  assert.match(source, /value=\{custom\}\s+aria-label="Custom instruction"/);
  assert.match(source, /onCloseAutoFocus=\{restoreClearFocus\}/);
});
function focusFixture() {
  let focus = 0,
    prevented = 0;
  const win = { location: { href: "local" } },
    target = {
      isConnected: true,
      getClientRects: () => [{}],
      closest: () => null,
      matches: () => false,
      focus: () => focus++,
    },
    opened = { target, url: "local", principal: "owner", generation: 3, confirmed: false };
  const g = {
    clearFocusRef: { current: opened },
    principalRef: { current: "owner" },
    storageGenerationRef: { current: 3 },
    restoreDialogFocus: loadUiModule("src/lib/dialog-return-focus.ts", {}, { window: win })
      .restoreDialogFocus,
  };
  const fn = vm.runInNewContext(
    ts.transpileModule("(" + variable(source, "restoreClearFocus") + ")", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    g,
  );
  return {
    g,
    win,
    target,
    opened,
    close: () => fn({ preventDefault: () => prevented++ }),
    counts: () => ({ focus, prevented }),
  };
}
for (const cause of ["Cancel", "Escape"])
  test(`${cause} close-autofocus restores exact Clear trigger without changing text`, () => {
    const f = focusFixture();
    f.close();
    assert.deepEqual(f.counts(), { focus: 1, prevented: 1 });
  });
for (const cause of [
  "navigation",
  "principal",
  "generation",
  "detached",
  "hidden",
  "disabled",
  "confirmed",
])
  test(`Canceled-clear focus skips ${cause}`, () => {
    const f = focusFixture();
    if (cause === "navigation") f.win.location.href = "other";
    if (cause === "principal") f.g.principalRef.current = "other";
    if (cause === "generation") f.g.storageGenerationRef.current++;
    if (cause === "detached") f.target.isConnected = false;
    if (cause === "hidden") f.target.getClientRects = () => [];
    if (cause === "disabled") f.target.matches = () => true;
    if (cause === "confirmed") f.opened.confirmed = true;
    f.close();
    assert.equal(f.counts().focus, 0);
    if (cause === "confirmed") assert.equal(f.counts().prevented, 0);
  });
test("Shared confirmation API forwards optional close autofocus without changing confirmation action", () => {
  const names = [
    "AlertDialog",
    "AlertDialogAction",
    "AlertDialogCancel",
    "AlertDialogContent",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogHeader",
    "AlertDialogTitle",
  ];
  const { ConfirmActionDialog } = loadUiModule("src/components/ConfirmActionDialog.tsx", {
    "lucide-react": { AlertTriangle: "AlertTriangle" },
    "@/components/ui/alert-dialog": Object.fromEntries(names.map((n) => [n, n])),
  });
  const callback = () => {},
    confirm = () => {};
  for (const onCloseAutoFocus of [undefined, callback]) {
    const tree = ConfirmActionDialog({
      open: true,
      onOpenChange() {},
      title: "Clear?",
      description: "Keep draft until confirmation",
      confirmLabel: "Clear",
      onConfirm: confirm,
      onCloseAutoFocus,
    });
    assert.equal(
      elements(tree, (n) => n.type === "AlertDialogContent")[0].props.onCloseAutoFocus,
      onCloseAutoFocus,
    );
    assert.equal(elements(tree, (n) => n.type === "AlertDialogAction")[0].props.onClick, confirm);
    assert.equal(elements(tree, (n) => n.type === "AlertDialogCancel").length, 1);
  }
});

test("Summary main targets cover independent states; only standalone control classes change", () => {
  const p = "src/routes/summary.tsx",
    s = read(p);
  assert.equal(normalize(s, true, true), normalize(old(p), false, true));
  const mains = [...s.matchAll(/<main\b[^>]*>/g)];
  assert.equal(mains.length, 2);
  for (const [main] of mains) {
    assert.match(main, /id="main-content"/);
    assert.match(main, /tabIndex=\{-1\}/);
  }
  assert.equal((s.match(/kova-summary-target/g) || []).length, 16);
  const a = ast(s);
  let count = 0;
  function visit(n) {
    if (ts.isJsxOpeningElement(n) && ["Link", "a"].includes(n.tagName.getText(a))) {
      const c = n.attributes.properties.find((p) => p.name?.getText(a) === "className")?.initializer
        ?.text;
      assert.ok(c.includes("kova-summary-target"));
      count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(a);
  assert.equal(count, 16);
});
test("No new Summary actions; Notifications content/handlers preserved across header utility placement", () => {
  const p = "src/routes/notifications.tsx";
  assert.equal(
    read(p)
      .replace('        id="main-content"\n        tabIndex={-1}\n', "")
      .replace("<AppShell utilitiesInHeader>", "<AppShell>"),
    old(p),
  );
  assert.match(read("src/styles/core-pages.css"), /\.kova-summary-page \.kova-summary-target/);
  assert.doesNotMatch(read("src/styles/core-pages.css"), /\.kova-summary-page\s+a\s*\{/);
});
