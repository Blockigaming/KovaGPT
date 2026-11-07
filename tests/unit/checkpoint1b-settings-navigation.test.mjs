import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
test("both settings entry modes expose all twenty-three requested primary destinations", () => {
  assert.match(source, /const groups = pageGroups;/);
  const primary = source.slice(
    source.indexOf("const pageGroups:"),
    source.indexOf("const groups = pageGroups"),
  );
  const labels = [...primary.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "General",
    "Appearance",
    "Notifications",
    "Profile",
    "Security and login",
    "Account",
    "Archived chats",
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
test("secondary panels remain searchable with parent return and explicit heading labelling", () => {
  const parents = Function(
    `return (${source.match(/const secondaryParents: Record<string, string> = (\{[\s\S]*?\});/)[1]})`,
  )();
  assert.deepEqual(
    Object.keys(parents).sort(),
    [
      "email",
      "logout",
      "report",
      "help",
      "about",
      "shortcuts",
      "memory",
      "security",
      "storage",
      "location",
      "parental",
      "family",
    ].sort(),
  );
  assert.equal(parents.memory, "data");
  assert.equal(parents.family, "linked");
  assert.match(source, /secondaryParents\[item.v\]/);
  assert.match(source, /title: "Related settings", tabs: matchingSecondaryTabs/);
  assert.match(source, /onClick=\{\(\) => selectTab\(parentTab\)\}/);
  assert.match(source, /aria-labelledby=\{currentSectionHeadingId\}/);
  assert.match(source, /id=\{currentSectionHeadingId\}/);
  assert.doesNotMatch(source, /<TabsTrigger value=\{tab\} className="sr-only"/);
  assert.match(source, /initialTab === "subscription" \? "billing" : initialTab/);
});
