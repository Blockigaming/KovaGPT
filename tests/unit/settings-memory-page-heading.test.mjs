import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const section = source.split("{/* MEMORY */}")[1].split('<TabsContent value="linked"')[0];
test("page Memory uses its shared title without losing the plan designation or review navigation", () => {
  assert.match(section, /\{!page \? <h3 className="text-sm font-semibold">Memory<\/h3> : null\}/);
  assert.match(section, /"Extended" : tier === "plus" \? "Enhanced" : "Basic"/);
  assert.match(section, /title="Use saved memory"/);
  assert.match(section, /to="\/memory"/);
  assert.match(section, /Open Memory Center/);
});
