import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
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
  const css = readFileSync("src/styles.css", "utf8").replace(/\s+/g, "");
  assert.match(
    css,
    /:not\(\.kova-sidebar-scrim\):not\(\.kova-browser-card\):not\(\.work-browser-preview\)/,
  );
});
