import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
const base = "e09840e1ddf843d7a4f1e79af66827ec877501e1";
test("Action color CSS remains intact after separately tested dropdown sizing markers", () => {
  const old = execFileSync("git", ["show", base + ":src/styles/core-system.css"], {
    encoding: "utf8",
  });
  const current = readFileSync("src/styles/core-system.css", "utf8");
  assert.ok(current.startsWith(old));
  const ast = postcss.parse(
      current.slice(old.length).split("/* Shared dropdown action targets;")[0],
    ),
    rules = [];
  ast.walkRules((r) => rules.push(r));
  assert.equal(rules.length, 5);
  for (const rule of rules) {
    for (const d of rule.nodes)
      assert.ok(
        ["background-color", "color"].includes(d.prop) ||
          d.prop.startsWith("--destructive-action-"),
      );
    if ([":root", ".dark"].includes(rule.selector)) {
      assert.ok(rule.nodes.every((d) => d.prop.startsWith("--destructive-action-")));
      continue;
    }
    for (const selector of rule.selectors) {
      assert.match(selector, /:where\(button, a, \[role="button"\], \[role="menuitem"\]\)/);
      assert.match(selector, /:not\(:disabled\)/);
      assert.match(selector, /aria-disabled="true"/);
      assert.match(selector, /:not\(\[data-disabled\]\)/);
    }
  }
});
