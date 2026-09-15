import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const lineage = JSON.parse(readFileSync("release-migration-lineage.json", "utf8"));
const entries = new Map(lineage.entries.map((entry) => [entry.remoteVersion, entry]));
const workspace = [
  "20260823151901",
  "20260823151927",
  "20260823214802",
  "20260824081357",
  "20260824081812",
  "20260824081926",
  "20260824082127",
  "20260824084005",
  "20260824085444",
];
const privileges = [
  "20260823215044",
  "20260823215132",
  "20260823215222",
  "20260823215259",
  "20260823215454",
  "20260823215619",
];
const unchanged = [
  "20260823092107",
  "20260823092450",
  "20260823215848",
  "20260824085042",
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

test("the September 15 review keeps all nineteen structural mappings blocked", () => {
  const expected = [...workspace, ...privileges, ...unchanged].sort();
  const unresolved = lineage.entries
    .filter((entry) => entry.status === "requires_schema_proof")
    .map((entry) => entry.remoteVersion)
    .sort();
  assert.deepEqual(unresolved, expected);
  assert.equal(new Set(expected).size, 19);
  assert.equal(entries.size, 24);
  assert.equal(lineage.entries.filter((entry) => entry.status === "equivalent").length, 5);
});

for (const version of workspace) {
  test(`${version} includes the canonical Day 15 reconciliation candidate`, () => {
    assert.equal(entries.get(version).status, "requires_schema_proof");
    assert.ok(entries.get(version).candidateSourceVersions.includes("20260904230332"));
  });
}

for (const version of privileges) {
  test(`${version} includes the canonical privilege reconciliation candidate`, () => {
    assert.equal(entries.get(version).status, "requires_schema_proof");
    assert.ok(entries.get(version).candidateSourceVersions.includes("20260904230329"));
  });
}

for (const version of unchanged) {
  test(`${version} retains its reviewed candidate set`, () => {
    assert.equal(entries.get(version).status, "requires_schema_proof");
  });
}

test("the reviewed lineage digest is stable", () => {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(lineage)))
    .digest("hex");
  assert.equal(digest, "6e057176ed1e36697afca9cb0c1e5a98f02a8b20f6ff82d9b54fc81ebce1fab4");
});
