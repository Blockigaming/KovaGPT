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

test("rectangular browser previews own their shape without a blanket pill override", () => {
  assert.match(
    readFileSync("src/styles.css", "utf8"),
    /@import "\.\/styles\/control-geometry\.css"/,
  );
  const geometry = postcss.parse(readFileSync("src/styles/control-geometry.css", "utf8"));
  geometry.walkRules((rule) => {
    if (rule.selector.includes("button"))
      assert.ok(
        !rule.nodes.some((node) => node.type === "decl" && node.prop === "border-radius"),
        "Shared native field and focus styles cannot reshape arbitrary button surfaces",
      );
  });
  for (const [path, selector] of [
    ["src/components/conversation-header.css", ".kova-browser-card"],
    ["src/components/work-browser-preview.css", ".work-browser-preview"],
  ]) {
    const sheet = postcss.parse(readFileSync(path, "utf8"));
    const rules = [];
    sheet.walkRules(selector, (rule) => rules.push(rule));
    assert.ok(rules.length, `${selector} owns its surface`);
    assert.ok(
      rules.some((rule) =>
        rule.nodes.some(
          (node) => node.prop === "border-radius" && node.value !== "var(--kova-radius-button)",
        ),
      ),
      `${selector} retains its rectangular preview radius`,
    );
  }
});
