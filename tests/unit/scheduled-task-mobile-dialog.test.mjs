import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = postcss.parse(readFileSync("src/styles/spec400-management.css", "utf8"));
const rules = [];
css.walkRules((rule) => rules.push(rule));
const phoneRule = (selector) => {
  const rule = rules.find(
    (entry) =>
      entry.selector === selector &&
      entry.parent.type === "atrule" &&
      entry.parent.params === "(max-width: 639px)",
  );
  assert.ok(rule, `${selector} must be scoped to phones`);
  return Object.fromEntries(
    rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node]),
  );
};

test("scheduled editor phone geometry retains viewport caps and semantic panel corners", () => {
  const rule = phoneRule("body .spec400-schedule-dialog[data-kova-dialog-surface]");
  for (const [property, value] of Object.entries({
    inset: "0",
    width: "100%",
    "max-width": "100%",
    height: "100dvh",
    "max-height": "100dvh",
  })) {
    assert.equal(rule[property].value, value);
    assert.equal(
      rule[property].important,
      true,
      `${property} must override generic important geometry`,
    );
  }
  assert.equal(rule["border-radius"].value, "var(--kova-radius-panel)");
  assert.ok(!rule["border-radius"].important);
  const panelTokens = [];
  postcss
    .parse(readFileSync("src/styles/visual-tokens.css", "utf8"))
    .walkDecls("--kova-radius-panel", (decl) =>
      panelTokens.push({ scope: decl.parent.selector, value: decl.value }),
    );
  assert.deepEqual(panelTokens, [{ scope: ":root", value: "24px" }]);
  assert.equal(rule.translate.value, "none");
  assert.equal(rule.transform.value, "none");
  assert.equal(rule.margin.value, "0");
  assert.equal(rule["padding-top"].value, "max(20px, env(safe-area-inset-top))");
  // Desktop sizing remains the existing centered 560px editor.
  const desktop = rules.find(
    (entry) =>
      entry.selector === ".spec400-schedule-dialog[data-kova-dialog-surface]" &&
      entry.parent.type === "root",
  );
  assert.ok(desktop.nodes.some((node) => node.prop === "max-width" && node.value === "560px"));
});

test("phone footer actions stack full width while keeping sticky save and safe-area spacing", () => {
  const base = rules.find(
    (entry) => entry.selector === ".spec400-schedule-footer" && entry.parent.type === "root",
  );
  assert.ok(base.nodes.some((node) => node.prop === "position" && node.value === "sticky"));
  const footer = phoneRule(".spec400-schedule-footer");
  assert.equal(footer.bottom.value, "-16px");
  assert.equal(footer["flex-direction"].value, "column");
  assert.equal(footer["align-items"].value, "stretch");
  assert.equal(footer["padding-bottom"].value, "max(16px, env(safe-area-inset-bottom))");
  const button = phoneRule(".spec400-schedule-footer button");
  assert.equal(button.flex.value, "none");
  assert.equal(button.width.value, "100%");
});
