import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
const base = "f3e01e37b212f61e69d6de385a1f2f405b0cfa7c";
test("Mobile utility stacking remains scoped below the sticky header", () => {
  const p = "src/styles/core-pages.css",
    s = readFileSync(p, "utf8");
  const rules = [];
  postcss.parse(s).walkRules((r) => {
    if (r.selector === ".kova-app-shell .kova-core-utilities") rules.push(r);
  });
  assert.equal(rules.length, 1);
  const r = rules[0];
  assert.equal(r.selector, ".kova-app-shell .kova-core-utilities");
  assert.equal(r.parent.params, "(max-width: 1023px)");
  assert.deepEqual(
    r.nodes.map((d) => [d.prop, d.value]),
    [
      ["position", "relative"],
      ["z-index", "calc(var(--z-header) - 1)"],
    ],
  );
});
test("Timer actions, focus/keyboard behavior and portaled menus/dialogs remain byte-identical", () => {
  for (const p of [
    "src/components/TimersWidget.tsx",
    "src/components/MobileTopBar.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/ui/alert-dialog.tsx",
    "src/components/ui/popover.tsx",
    "src/styles/chatgpt-final-parity.css",
  ])
    assert.equal(
      readFileSync(p, "utf8"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
      p,
    );
});
