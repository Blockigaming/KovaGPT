import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
const path = "src/routes/help.tsx",
  base = "20a685f2c10f0d97a361639720edf013df78c23f";
const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
const source = process.env.KOVA_REGRESSION_BASE ? before : readFileSync(path, "utf8");
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  const result = [];
  function visit(n) {
    if (predicate(n)) result.push(n);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return result;
}
const attr = (node, name) =>
  node.attributes.properties.find((p) => p.name?.getText(ast) === name)?.initializer?.getText(ast);
test("Name and Email use identical label rows and input spacing inside the unchanged responsive grid", () => {
  const rows = [];
  for (const id of ["support-name", "support-email"]) {
    const label = find(
      (n) =>
        ts.isJsxOpeningElement(n) &&
        n.tagName.getText(ast) === "Label" &&
        attr(n, "htmlFor") === JSON.stringify(id),
    )[0];
    const row = label.parent.parent;
    assert.ok(ts.isJsxElement(row));
    rows.push(attr(row.openingElement, "className"));
    assert.equal(row.openingElement.tagName.getText(ast), "div");
    assert.equal(rows.at(-1), '"mb-2 flex min-h-4 items-baseline justify-between"');
    const input = find(
      (n) => ts.isJsxSelfClosingElement(n) && attr(n, "id") === JSON.stringify(id),
    )[0];
    assert.equal(attr(input, "className"), '"h-12"');
    assert.equal(
      attr(row.parent.parent.openingElement, "className"),
      '"grid gap-5 sm:grid-cols-2"',
    );
  }
  assert.equal(rows[0], rows[1]);
});
test("Only declared label wrappers, height and spacing change; copy, field semantics, validation and all handlers remain exact", () => {
  const expected = before
    .replace(
      /(<Label htmlFor="support-email">[\s\S]*?<\/Label>)/,
      '<div className="mb-2 flex items-baseline justify-between">$1</div>',
    )
    .replace(
      'id="support-email"\n                  className="mt-2 h-12"',
      'id="support-email"\n                  className="h-12"',
    )
    .replace(
      /className="mb-2 flex items-baseline justify-between"(>\s*<Label htmlFor="support-(?:name|email)")/g,
      'className="mb-2 flex min-h-4 items-baseline justify-between"$1',
    );
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source), compile(expected));
  assert.deepEqual(eventAttributes(source), eventAttributes(before));
});
