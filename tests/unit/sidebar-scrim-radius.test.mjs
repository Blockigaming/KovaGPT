import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
const read = (path) => readFileSync(path, "utf8");
const radius = (rule) =>
  rule.nodes.findLast((node) => node.type === "decl" && node.prop === "border-radius");
test("pill action defaults exclude the full-viewport sidebar scrim without important specificity", () => {
  const sheet = postcss.parse(read("src/styles/control-geometry.css"));
  const rule = sheet.nodes.find((node) => node.type === "rule" && node.selector.startsWith("body"));
  assert.ok(rule);
  assert.equal(radius(rule).value, "var(--kova-radius-button)");
  assert.ok(!radius(rule).important);
  assert.match(rule.selector, /\.kova-sidebar-scrim/);
  assert.match(rule.selector, /:not\(\s*:where\(/);
  assert.match(read("src/styles/visual-tokens.css"), /--kova-radius-compact:\s*10px;/);
});
test("sidebar backdrop keeps its explicit square-corner rule without an important override", () => {
  let backdrop;
  postcss.parse(read("src/styles.css")).walkRules((rule) => {
    if (rule.selector.endsWith("button.kova-sidebar-scrim")) backdrop = rule;
  });
  assert.ok(backdrop);
  assert.equal(radius(backdrop).value, "0");
  assert.ok(!radius(backdrop).important);
});
