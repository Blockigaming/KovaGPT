import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Day 16 exposes honest progress and strict completion commands", () => {
  assert.equal(pkg.scripts["release:day16:ledger"], "node scripts/release/day16-ledger.mjs");
  assert.equal(
    pkg.scripts["release:day16:complete"],
    "node scripts/release/day16-ledger.mjs --require-complete",
  );
});
