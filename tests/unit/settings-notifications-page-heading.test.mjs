import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const section = source.split("{/* NOTIFICATIONS */}")[1].split("{/* PARENTAL */}")[0];
test("Notifications uses the shared heading in the page and dialog", () => {
  assert.match(source, /<h2 id=\{currentSectionHeadingId\}[^>]*>\s*\{activeTab.label\}/);
  assert.match(section, /aria-labelledby=\{currentSectionHeadingId\}/);
  assert.doesNotMatch(section, /<h[23]\b/);
  assert.match(section, /<PwaSettings ownerId=\{isLoaded \? userKey : null\}/);
  assert.match(section, /<AccountEmailPreferences ownerId=\{isLoaded \? userKey : null\}/);
  assert.equal((section.match(/<AccountEmailPreferences\b/g) ?? []).length, 1);
  assert.doesNotMatch(section, /Optional email preferences are unavailable|Always on/);
});
