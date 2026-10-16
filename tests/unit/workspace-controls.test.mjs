import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { jsxContract } from "../helpers/jsx-contract.mjs";
const base = "33ddf1febfc15a358dbef6c1df16040476486b43";
// Memory gained the separately tested, authorized scoped-clear integration.
// Retain the original presentation baseline for every other route.
const memoryBehaviorBase = "007bd8b19ad0720f10c84482609875704872fd41";
const paths = [
  "study",
  "context-packs",
  "prompt-studio",
  "goals",
  "kovas",
  "omega",
  "memory",
  "brain",
  "knowledge-graph",
]
  .map((n) => "src/routes/" + n + ".tsx")
  .concat("src/components/SitesPage.tsx");
function normalize(source, path) {
  // Explicit header utility relocation is covered by workspace-header-utilities.
  source = source.replaceAll("<AppShell utilitiesInHeader>", "<AppShell>");
  if (path.endsWith("/kovas.tsx"))
    source = source.replace(/<main\b[^>]*>/, "").replace("</main>", "");
  source = source.replace(/<rect\s+className="kova-graph-node-hit"[\s\S]*?\/>/, "");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = ts.transform(ast, [
    (ctx) => (root) =>
      ts.visitNode(root, function visit(n) {
        if (
          ts.isJsxAttribute(n) &&
          (n.name.getText(ast) === "className" ||
            (n.name.getText(ast) === "tabIndex" && n.initializer?.getText(ast) === "{-1}") ||
            (n.name.getText(ast) === "id" && n.initializer?.text === "main-content"))
        )
          return undefined;
        return ts.visitEachChild(n, visit, ctx);
      }),
  ]);
  const text = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  if (path.endsWith("/knowledge-graph.tsx")) return jsxContract(text);
  return ts.transpileModule(text, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
for (const path of paths)
  test(`${path}: declared presentation/Memory integration baseline; handlers and values preserved`, () => {
    const current = readFileSync(path, "utf8"),
      old = execFileSync(
        "git",
        ["show", (path.endsWith("/memory.tsx") ? memoryBehaviorBase : base) + ":" + path],
        { encoding: "utf8" },
      );
    assert.equal(normalize(current, path), normalize(old, path));
    const mains = [...current.matchAll(/<main\b[^>]*>/g)];
    assert.equal(mains.length, path.endsWith("/omega.tsx") ? 3 : 1);
    for (const [main] of mains) {
      assert.match(main, /id="main-content"/);
      assert.match(main, /tabIndex=\{-1\}/);
      assert.match(main, /kova-workspace-controls/);
    }
    assert.equal((current.match(/id="main-content"/g) || []).length, mains.length);
  });
test("Omega main branches return independently; Custom Kovas wraps both loading/loaded states", () => {
  const omega = readFileSync("src/routes/omega.tsx", "utf8");
  assert.match(omega, /if \(!isLoaded\)\s+return/);
  assert.match(omega, /if \(!isSignedIn\)\s+return/);
  const kovas = readFileSync("src/routes/kovas.tsx", "utf8");
  assert.match(kovas, /<main[^>]*>[\s\S]*?\{isLoaded \? \([\s\S]*?<\/main>/);
  assert.equal((kovas.match(/kova-directory-filter/g) || []).length, 2);
  assert.equal((kovas.match(/kova-directory-search/g) || []).length, 1);
});
test("Discovery control and shared Button/Input/native primitives untouched", () => {
  for (const p of [
    "src/routes/discovery.tsx",
    "src/components/ui/button.tsx",
    "src/components/ui/input.tsx",
    "src/components/ui/checkbox.tsx",
    "src/components/ui/radio-group.tsx",
    "src/components/ui/switch.tsx",
  ])
    assert.equal(
      readFileSync(p, "utf8"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
    );
});

test("Study import only adds containment marker; file validation/handling unchanged", () => {
  const p = "src/components/StudyPanel.tsx",
    current = readFileSync(p, "utf8"),
    old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
  assert.equal(current.replace("kova-study-import ", ""), old);
});

test("Project content opt-in preserves exact router, tab and data behavior", () => {
  const p = "src/routes/projects.$projectId.tsx",
    current = readFileSync(p, "utf8"),
    old = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
  assert.equal(current.replaceAll("kova-workspace-controls mt-4", "mt-4"), old);
  for (const tab of ["files", "images", "notes", "memory", "collaboration"])
    assert.ok(
      current.includes(`<TabsContent value="${tab}" className="kova-workspace-controls mt-4">`),
    );
  for (const p of [
    "src/components/CollaborativeProjectNotes.tsx",
    "src/components/ProjectCollaboration.tsx",
  ])
    assert.equal(
      readFileSync(p, "utf8"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
    );
});

test("Graph hit area is50 viewBox units with unchanged720px contained canvas and node activation", () => {
  const s = readFileSync("src/routes/knowledge-graph.tsx", "utf8");
  assert.match(
    s,
    /className="kova-graph-node-hit"\s+x=\{node.x - 25\}\s+y=\{node.y - 25\}\s+width=\{50\}\s+height=\{50\}\s+fill="transparent"\s+aria-hidden="true"/,
  );
  assert.match(s, /viewBox="0 0 800 600"/);
  assert.match(s, /min-w-\[720px\]/);
  assert.ok((50 * 720) / 800 >= 44);
  assert.equal((s.match(/kova-graph-resource/g) || []).length, 2);
});

// The newer Memory baseline must not conceal changes to existing mutation paths.
test("scoped Memory clear preserves the original edit/delete/merge/review handlers", () => {
  const path = "src/routes/memory.tsx";
  const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
  const after = readFileSync(path, "utf8");
  function handlers(source) {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const result = {};
    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ["save", "del", "merge", "reviewLatest"].includes(node.name.getText(ast))
      ) {
        result[node.name.getText(ast)] = ts
          .createPrinter()
          .printNode(ts.EmitHint.Unspecified, node.initializer, ast);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return result;
  }
  assert.deepEqual(Object.keys(handlers(after)).sort(), ["del", "merge", "reviewLatest", "save"]);
  assert.deepEqual(handlers(after), handlers(before));
});
