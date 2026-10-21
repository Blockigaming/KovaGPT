import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("account policy links preserve the signup form and identify new-tab destinations", () => {
  const source = ts.createSourceFile(
    "auth.tsx",
    readFileSync("src/routes/auth.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const links = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "a") {
      const attrs = Object.fromEntries(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((a) => [
            a.name.getText(source),
            a.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : null,
          ]),
      );
      if (["/terms", "/privacy"].includes(attrs.href)) links.push(attrs);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.match(link.rel, /noopener/);
    assert.match(link["aria-label"], /opens in a new tab/);
    assert.match(link.className, /min-h-11/);
  }
});
