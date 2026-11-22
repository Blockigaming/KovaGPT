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
  if (
    ts.isJsxElement(node) &&
    ["button", "Button"].includes(node.openingElement.tagName.getText(ast))
  ) {
    const label = node.children
      .filter(ts.isJsxText)
      .map((child) => child.text.trim())
      .join("");
    if (["Copy my draft", "Load current version", "Reconnect"].includes(label)) {
      const attributes = node.openingElement.attributes.properties;
      buttons.set(label, {
        element: node.openingElement.tagName.getText(ast),
        variant: attributes.find((attr) => attr.name?.getText(ast) === "variant")?.initializer
          ?.text,
        size: attributes.find((attr) => attr.name?.getText(ast) === "size")?.initializer?.text,
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

test("Result recovery uses the shared 36px desktop and 44px touch Button geometry", () => {
  assert.equal(buttons.size, 3);
  for (const [label, { element, variant, size, classes }] of buttons) {
    assert.equal(element, "Button", label);
    assert.equal(variant, "outline", label);
    assert.equal(size, undefined, label);
    assert.doesNotMatch(classes ?? "", /\b(?:min-h-|h-|rounded-|px-)/, label);
  }
  assert.match(source, /import \{ Button \} from "@\/components\/ui\/button"/);
  const primitive = readFileSync("src/components/ui/button.tsx", "utf8");
  assert.match(primitive, /default: "h-9 /);
  assert.ok(primitive.includes("[@media(pointer:coarse)]:min-h-11"));
  assert.match(primitive, /rounded-full/);
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
