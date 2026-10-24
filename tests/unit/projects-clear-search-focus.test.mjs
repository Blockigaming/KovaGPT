import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/projects.tsx", "utf8");
const parsed = ts.createSourceFile(
  "projects.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let inputRef, clearHandler;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "Input") {
    const attributes = node.attributes.properties;
    const label = attributes.find(
      (a) => ts.isJsxAttribute(a) && a.name.getText(parsed) === "aria-label",
    );
    if (
      label?.initializer &&
      ts.isStringLiteral(label.initializer) &&
      label.initializer.text === "Search projects"
    ) {
      inputRef = attributes
        .find((a) => ts.isJsxAttribute(a) && a.name.getText(parsed) === "ref")
        ?.initializer?.expression?.getText(parsed);
    }
  }
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(parsed) === "Button" &&
    node.children.some((child) => ts.isJsxText(child) && child.text.trim() === "Clear search")
  ) {
    clearHandler = node.openingElement.attributes.properties
      .find((a) => ts.isJsxAttribute(a) && a.name.getText(parsed) === "onClick")
      ?.initializer?.expression?.getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);

test("Clear search clears the filter and synchronously focuses the retained search input", () => {
  assert.equal(inputRef, "searchInputRef");
  assert.ok(clearHandler);
  const js = ts.transpileModule(`return (${clearHandler});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [];
  const ref = { current: { focus: () => calls.push("focus") } };
  const handler = new Function("setQuery", inputRef, js)(
    (value) => calls.push(["query", value]),
    ref,
  );
  handler();
  assert.deepEqual(calls, [["query", ""], "focus"]);
  assert.doesNotMatch(clearHandler, /setTimeout|requestAnimationFrame|await/);
  ref.current = null;
  assert.doesNotThrow(handler);
});
