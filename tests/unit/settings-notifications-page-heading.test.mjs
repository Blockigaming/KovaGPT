import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const section = source.split("{/* NOTIFICATIONS */}")[1].split("{/* PARENTAL */}")[0];
test("Notifications uses the shared section heading in both Settings surfaces", () => {
  assert.match(section, /aria-labelledby=\{currentSectionHeadingId\}/);
  assert.match(source, /<h2 id=\{currentSectionHeadingId\}/);
  assert.doesNotMatch(section, /<h3[^>]*>Notifications<\/h3>/);
  assert.match(section, /<PwaSettings ownerId=\{isLoaded \? userKey : null\}/);
  assert.match(section, /<AccountEmailPreferences ownerId=\{isLoaded \? userKey : null\}/);
  assert.equal((section.match(/<AccountEmailPreferences\b/g) ?? []).length, 1);
  assert.doesNotMatch(section, /Optional email preferences are unavailable|Always on/);
});
