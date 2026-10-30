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
  const rule = phoneRule(".spec400-schedule-dialog[data-kova-dialog-surface]");
  for (const [property, value] of Object.entries({
    width: "calc(100vw - 24px)",
    "max-width": "calc(100vw - 24px)",
    "max-height": "calc(100dvh - 24px)",
    padding: "20px",
  })) {
    assert.equal(rule[property].value, value);
    assert.ok(!rule[property].important, `${property} has one canonical geometry owner`);
  }
  const panelTokens = [];
  postcss
    .parse(readFileSync("src/styles/visual-tokens.css", "utf8"))
    .walkDecls("--kova-radius-panel", (decl) =>
      panelTokens.push({ scope: decl.parent.selector, value: decl.value }),
    );
  assert.deepEqual(panelTokens, [{ scope: ":root", value: "24px" }]);
  // The editor remains a centered, scrollable dialog at every viewport size.
  const desktop = rules.find(
    (entry) =>
      entry.selector === ".spec400-schedule-dialog[data-kova-dialog-surface]" &&
      entry.parent.type === "root",
  );
  assert.ok(desktop.nodes.some((node) => node.prop === "max-width" && node.value === "560px"));
  assert.ok(
    desktop.nodes.some(
      (node) => node.prop === "border-radius" && node.value === "var(--kova-radius-panel)",
    ),
  );
  assert.ok(desktop.nodes.some((node) => node.prop === "overflow-y" && node.value === "auto"));
  const sharedDialog = readFileSync("src/components/ui/dialog.tsx", "utf8");
  assert.match(sharedDialog, /fixed left-1\/2 top-1\/2/);
  assert.match(sharedDialog, /env\(safe-area-inset-top\).*env\(safe-area-inset-bottom\)/);
});

test("phone footer actions wrap while keeping sticky save and the dialog padding", () => {
  const base = rules.find(
    (entry) => entry.selector === ".spec400-schedule-footer" && entry.parent.type === "root",
  );
  assert.ok(base.nodes.some((node) => node.prop === "position" && node.value === "sticky"));
  const footer = phoneRule(".spec400-schedule-footer");
  assert.equal(footer.bottom.value, "-20px");
  assert.equal(footer["flex-wrap"].value, "wrap");
  assert.equal(footer["padding-bottom"].value, "20px");
  const button = phoneRule(".spec400-schedule-footer button");
  assert.equal(button.flex.value, "none");
  assert.match(
    readFileSync("src/components/ui/button.tsx", "utf8"),
    /\[@media\(pointer:coarse\)\]:min-h-11/,
  );
});
