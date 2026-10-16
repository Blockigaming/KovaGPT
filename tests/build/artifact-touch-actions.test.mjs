import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const source = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const ast = ts.createSourceFile(
  "editor.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const sections = {};
function visit(n) {
  if (ts.isJsxElement(n)) {
    const cls = n.openingElement.attributes.properties.find(
      (p) => p.name?.getText(ast) === "className",
    )?.initializer?.text;
    for (const name of ["kova-artifact-footer", "kova-artifact-recovery"])
      if (cls?.includes(name)) sections[name] = n;
  }
  ts.forEachChild(n, visit);
}
visit(ast);
const classes = (n) =>
  n.attributes.properties.find((p) => p.name?.getText(ast) === "className")?.initializer?.text ??
  "";
const escaped = (value) =>
  value
    .split(" ")
    .map((n) => n.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
const css = readFileSync(
  "dist/client/assets/" + readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
  "utf8",
);
for (const width of [390, 430, 767, 822, 1440])
  test(`Artifact footer/recovery actual action classes at ${width}`, () => {
    const c = compiledCascade(css, width, width < 768),
      root = element("html");
    for (const [name, node] of Object.entries(sections)) {
      const section = element("div", escaped(classes(node.openingElement)), root);
      assert.equal(c.value(section, "flex-wrap"), "wrap");
      if (width < 768) {
        assert.equal(c.value(section, "overflow"), "auto");
        assert.equal(c.value(section, "flex-shrink"), "0");
        assert.equal(c.value(section, "max-height"), name.endsWith("footer") ? "35dvh" : "25dvh");
      } else {
        assert.notEqual(c.value(section, "overflow"), "auto");
        assert.notEqual(c.value(section, "flex-shrink"), "0");
      }
      let count = 0;
      const check = (n) => {
        if (
          (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
          ["button", "select"].includes(n.tagName.getText(ast))
        ) {
          count++;
          const action = element(n.tagName.getText(ast), escaped(classes(n)), section);
          if (width < 768) {
            assert.equal(c.value(action, "min-height"), "44px");
            assert.equal(c.value(action, "min-width"), "44px");
            assert.equal(c.value(action, "height"), "auto");
            assert.equal(c.value(action, "white-space"), "normal");
            assert.equal(c.value(action, "max-width"), "100%");
          } else assert.notEqual(c.value(action, "min-height"), "44px");
        }
        ts.forEachChild(n, check);
      };
      check(node);
      assert.ok(count >= 3);
    }
    assert.equal(Object.keys(sections).length, 2);
  });
