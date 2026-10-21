import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import postcss from "postcss";
import { transitionBrowserPreview as move } from "../../review-kit/browser-takeover-fixture.mjs";
test("takeover waits for paused automation and never resumes implicitly", () => {
  assert.equal(move("active", "takeover"), "active");
  assert.equal(move("active", "pause"), "paused");
  assert.equal(move("paused", "takeover"), "owner");
  assert.equal(move("owner", "resume"), "owner");
  assert.equal(move("owner", "release"), "paused");
  assert.equal(move("paused", "resume"), "active");
});
test("ending is terminal for all subsequent control actions", () => {
  for (const s of ["active", "paused", "owner"]) assert.equal(move(s, "end"), "ended");
  for (const a of ["takeover", "resume", "release", "pause"])
    assert.equal(move("ended", a), "ended");
});

test("rectangular browser previews are excluded from pill-button overrides", () => {
  assert.match(
    readFileSync("src/styles.css", "utf8"),
    /@import "\.\/styles\/control-geometry\.css"/,
  );
  const sheet = postcss.parse(readFileSync("src/styles/control-geometry.css", "utf8"));
  const policy = sheet.nodes.find(
    (node) => node.type === "rule" && node.selector.startsWith("body"),
  );
  assert.ok(policy, "The shared action geometry policy is present");
  const exclusions = policy.selector.match(/:not\(\s*:where\(([\s\S]+)\)\s*\)$/)?.[1];
  assert.ok(exclusions, "Surface exclusions remain inside the policy's negation");
  const excludedSelectors = new Set(postcss.list.comma(exclusions));
  for (const selector of [".kova-sidebar-scrim", ".kova-browser-card", ".work-browser-preview"])
    assert.ok(excludedSelectors.has(selector), `${selector} is excluded from pill geometry`);
  const radius = policy.nodes.find((node) => node.type === "decl" && node.prop === "border-radius");
  assert.equal(radius.value, "var(--kova-radius-button)");
  assert.ok(!radius.important, "Shared geometry must not override surface-specific radii");
});
