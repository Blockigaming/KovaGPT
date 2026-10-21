import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("src/routes/library.tsx", "utf8");
const ast = ts.createSourceFile(
  "library.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const all = [];
const visit = (n) => {
  all.push(n);
  ts.forEachChild(n, visit);
};
visit(ast);
const button = all.find(
  (n) =>
    ts.isJsxElement(n) &&
    n.openingElement.tagName.getText(ast) === "Button" &&
    n.children.some((c) => ts.isJsxText(c) && c.text.trim() === "Move to folder"),
);
const callback = button.openingElement.attributes.properties
  .find((p) => p.name?.getText(ast) === "onClick")
  .initializer.expression.getText(ast);
const compiled = ts.transpileModule(`const action=${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ ready = true, selected = ["sample"], disabled = false, exists = true } = {}) {
  const focus = [],
    scroll = [];
  const picker = {
      matches: () => disabled,
      focus: () => focus.push("picker"),
      scrollIntoView: () => scroll.push("picker"),
    },
    summary = { focus: () => focus.push("summary"), scrollIntoView: () => scroll.push("summary") };
  const details = {
    open: false,
    querySelector: (selector) => (selector === "summary" ? summary : picker),
  };
  const action = new Function(
    "foldersDetailsRef",
    "principalReady",
    "selectedDurableIds",
    `${compiled};return action;`,
  )({ current: exists ? details : null }, ready, selected);
  return { action, details, focus, scroll };
}
test("selection Move reveals existing folder destination and hands off keyboard focus without a second write path", () => {
  const f = fixture();
  f.action();
  assert.equal(f.details.open, true);
  assert.deepEqual(f.focus, ["picker"]);
  assert.deepEqual(f.scroll, ["picker"]);
  assert.doesNotMatch(callback, /fetch|moveLibraryItems|setSelected/);
});
test("unavailable folder controls retain safe disclosure focus; stale/empty selection does nothing", () => {
  const f = fixture({ disabled: true });
  f.action();
  assert.deepEqual(f.focus, ["summary"]);
  for (const options of [{ ready: false }, { selected: [] }, { exists: false }]) {
    const g = fixture(options);
    g.action();
    assert.equal(g.details.open, false);
    assert.deepEqual(g.focus, []);
  }
});
