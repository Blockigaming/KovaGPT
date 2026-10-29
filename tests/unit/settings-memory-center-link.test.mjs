import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const settings = ts.createSourceFile(
  "SettingsDialog.tsx",
  readFileSync("src/components/SettingsDialog.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function findAll(node, predicate) {
  const found = [];
  const visit = (value) => {
    if (predicate(value)) found.push(value);
    ts.forEachChild(value, visit);
  };
  visit(node);
  return found;
}
const attr = (element, name) =>
  element.openingElement.attributes.properties.find(
    (value) => ts.isJsxAttribute(value) && value.name.getText(settings) === name,
  )?.initializer;
const panels = findAll(
  settings,
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(settings) === "TabsContent" &&
    attr(node, "value")?.text === "memory",
);
assert.equal(panels.length, 1);
const links = findAll(
  panels[0],
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(settings) === "Link" &&
    attr(node, "to")?.text === "/memory",
);
assert.equal(links.length, 1);
const link = links[0];

test("Settings Memory exposes one ordinary, clearly named 44px Memory Center navigation link", () => {
  assert.match(link.getText(settings), />\s*Open Memory Center\s*</);
  assert.match(attr(link, "className").text, /\bmin-h-11\b/);
  assert.equal(attr(link, "target"), undefined);
  assert.equal(attr(link, "role"), undefined);
  assert.equal(attr(link, "disabled"), undefined);
  assert.equal(attr(link, "aria-disabled"), undefined);
});

test("Memory Center navigation only dismisses Settings and leaves routing and settings semantics intact", () => {
  const source = attr(link, "onClick").expression.getText(settings);
  const values = [];
  const click = new Function(
    "onOpenChange",
    ts.transpileModule(`return (${source});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )((value) => values.push(value));
  click({
    preventDefault() {
      throw new Error("Ordinary navigation must remain available");
    },
  });
  assert.deepEqual(values, [false]);
  assert.doesNotMatch(source, /onChange|fetch|delete|save|rememberAcross/);
});

test("the destination is the existing Memory Center route and dirty review gains no bypass link", () => {
  const route = readFileSync("src/routes/memory.tsx", "utf8");
  assert.match(route, /createFileRoute\("\/memory"\)/);
  assert.match(route, /title="Memory"/);
  assert.match(route, /data-ui-reference="chatgpt\.settings\.memory"/);
  const dialog = readFileSync("src/components/ReviewedMemoryDialog.tsx", "utf8");
  assert.doesNotMatch(dialog, /(?:to|href)="\/memory"/);
  assert.match(dialog, /Discard this memory draft/);
});
