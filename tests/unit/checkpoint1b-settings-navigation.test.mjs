import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
test("both settings entry modes expose all twenty-two destinations through the grouped hierarchy", () => {
  assert.match(source, /const groups = destinationGroups;/);
  const primary = source.slice(
    source.indexOf("const destinationGroups:"),
    source.indexOf("const destinations = destinationGroups.flatMap"),
  );
  const labels = [...primary.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "General",
    "Appearance",
    "Notifications",
    "Profile",
    "Security and login",
    "Account",
    "Parental controls",
    "Voice",
    "Storage",
    "Data controls",
    "Personalization",
    "Keyboard",
    "Usage",
    "Connections",
    "Cloud Browser",
    "Family Center",
    "Location",
    "Subscriptions",
    "Report an issue",
    "Help center",
    "About",
    "Log out",
  ]);
});
test("all settings sections are direct sidebar destinations with full-text search", () => {
  assert.doesNotMatch(source, /const secondaryParents:|matchingSecondaryTabs|kova-settings-related/);
  assert.match(source, /const allTabs = destinations;/);
  assert.match(source, /SETTINGS_DESCRIPTIONS\[item\.v\] \?\? ""/);
  assert.match(source, /tabs: group\.tabs\.filter\(matchesSettingsQuery\)/);
  assert.match(source, /aria-labelledby=\{currentSectionHeadingId\}/);
  assert.match(source, /id=\{currentSectionHeadingId\}/);
  assert.doesNotMatch(source, /<TabsTrigger value=\{tab\} className="sr-only"/);
  assert.match(source, /initialTab === "subscription" \? "billing" : initialTab/);
});
