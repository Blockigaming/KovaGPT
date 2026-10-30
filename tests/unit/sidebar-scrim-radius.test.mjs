import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
const read = (path) => readFileSync(path, "utf8");
const radius = (rule) =>
  rule.nodes.findLast((node) => node.type === "decl" && node.prop === "border-radius");
test("shared fields do not impose a blanket button shape on the full-viewport scrim", () => {
  const sheet = postcss.parse(read("src/styles/control-geometry.css"));
  const blanket = [];
  sheet.walkRules((rule) => {
    if (radius(rule) && /(?:^|,)\s*(?:body\s+)?(?:button|:where\(button)/.test(rule.selector))
      blanket.push(rule);
  });
  assert.equal(blanket.length, 0, "Button components and sidebar rows own their shape");
  assert.match(read("src/styles/visual-tokens.css"), /--kova-radius-compact:\s*10px;/);
});
test("sidebar backdrop keeps its explicit square-corner rule without an important override", () => {
  let backdrop;
  postcss.parse(read("src/styles/sidebar-core.css")).walkRules((rule) => {
    if (rule.selector.endsWith("button.kova-sidebar-scrim")) backdrop = rule;
  });
  assert.ok(backdrop);
  assert.equal(radius(backdrop).value, "0");
  assert.ok(!radius(backdrop).important);
});
