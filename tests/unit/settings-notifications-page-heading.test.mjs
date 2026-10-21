import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const section = source.split("{/* NOTIFICATIONS */}")[1].split("{/* PARENTAL */}")[0];
test("page Notifications uses the shared title while the dialog retains its inner heading", () => {
  assert.match(
    section,
    /\{!page \? <h3 className="text-sm font-semibold">Notifications<\/h3> : null\}/,
  );
  assert.match(section, /<PwaSettings ownerId=\{isLoaded \? userKey : null\}/);
  assert.match(section, /<AccountEmailPreferences ownerId=\{isLoaded \? userKey : null\}/);
  assert.equal((section.match(/<AccountEmailPreferences\b/g) ?? []).length, 1);
  assert.doesNotMatch(section, /Optional email preferences are unavailable|Always on/);
});
