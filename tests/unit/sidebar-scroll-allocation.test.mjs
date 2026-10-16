import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("features and history share the shrinking scroll region; header and account controls remain outside", () => {
  const file = ts.createSourceFile(
    "Sidebar.tsx",
    readFileSync("src/components/Sidebar.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let region;
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.text === "className" &&
          ts.isStringLiteral(prop.initializer) &&
          prop.initializer.text === "kova-sidebar-scroll",
      )
    )
      region = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(region);
  const contents = region.getText(file);
  for (const marker of [
    'aria-label="KovaGPT features"',
    '"Scheduled tasks"',
    "<span>More</span>",
    'aria-label="Chats"',
  ])
    assert.ok(contents.includes(marker), marker);
  assert.doesNotMatch(contents, /kova-sidebar-header|kova-sidebar-footer|Log in to KovaGPT/);
  const css = readFileSync("src/styles/sidebar-core.css", "utf8");
  assert.doesNotMatch(css, /@media \(max-width: 1023px\) and \(max-height: 560px\)/);
});
