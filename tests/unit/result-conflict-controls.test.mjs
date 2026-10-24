import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const ast = ts.createSourceFile(
  "ArtifactEditor.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const buttons = new Map();
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button") {
    const label = node.children
      .filter(ts.isJsxText)
      .map((child) => child.text.trim())
      .join("");
    if (["Copy my draft", "Load current version", "Reconnect"].includes(label)) {
      const attributes = node.openingElement.attributes.properties;
      buttons.set(label, {
        classes: attributes.find((attr) => attr.name?.getText(ast) === "className")?.initializer
          ?.text,
        action: attributes
          .find((attr) => attr.name?.getText(ast) === "onClick")
          ?.initializer?.getText(ast),
      });
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

test("Result conflict recovery controls keep 44px targets, 8px corners and 16px inline padding", () => {
  assert.equal(buttons.size, 3);
  for (const [label, { classes }] of buttons) {
    assert.match(classes, /\bmin-h-11\b/, label);
    assert.match(classes, /\brounded-lg\b/, label);
    assert.match(classes, /\bpx-4\b/, label);
    assert.doesNotMatch(classes, /\b(?:min-h-9|px-3)\b/, label);
  }
});

test("recovery buttons retain explicit copy, adopt and reconnect handlers", () => {
  assert.match(buttons.get("Copy my draft").action, /\(\) => void copy\(value\)/);
  assert.match(
    buttons.get("Load current version").action,
    /const content = collaboration\.adopt\(\)/,
  );
  assert.match(buttons.get("Load current version").action, /if \(content !== null\)/);
  assert.match(buttons.get("Load current version").action, /setValue\(content\)/);
  assert.match(buttons.get("Reconnect").action, /collaboration\.retry/);
});
