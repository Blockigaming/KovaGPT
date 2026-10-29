import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
const component = readFileSync("src/components/ChatMessage.tsx", "utf8");
const styles = readFileSync("src/components/response-action-refinement.css", "utf8");
test("response actions use compact desktop geometry and 44px coarse targets", () => {
  assert.match(component, /import "\.\/response-action-refinement\.css"/);
  assert.match(component, /kova-response-action-bar/);
  const sheet = postcss.parse(styles);
  const controls = [];
  sheet.walkRules((rule) => {
    if (
      rule.selector.includes(".kova-response-action-bar") &&
      rule.selector.includes("button.kova-message-icon-action")
    )
      controls.push(rule);
  });
  assert.equal(controls.length, 2);
  for (const rule of controls) {
    const values = Object.fromEntries(
      rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
    );
    const coarse = rule.parent.type === "atrule";
    if (coarse) assert.match(rule.parent.params, /any-pointer: coarse/);
    for (const key of ["width", "height", "min-width", "min-height", "flex-basis"])
      assert.equal(values[key], coarse ? "44px" : "32px");
    if (!coarse) assert.equal(values["border-radius"], "var(--kova-radius-compact)");
    assert.ok(!rule.nodes.some((node) => node.important));
  }
  assert.match(styles, /stroke-linecap: round/);
});

test("feedback recovery remains available in More without stretching the toolbar", () => {
  assert.doesNotMatch(component, />\s*Retry rating\s*</);
  assert.match(
    component,
    /<DropdownMenuItem[\s\S]*?setFeedbackReload[\s\S]*?Retry loading response feedback/,
  );
});

test("assistant and Images retain bottom account access without duplicate top avatars", () => {
  for (const path of ["src/routes/index.tsx", "src/routes/images.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /<UserButton\b/);
  assert.match(readFileSync("src/components/Sidebar.tsx", "utf8"), /kova-rail-account/);
});
