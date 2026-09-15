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
const unchanged = ["20260823092107", "20260823092450", "20260823215848", "20260824085042"];

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
  assert.equal(lineage.entries.filter((entry) => entry.status === "schema_proven").length, 0);
});

test("workspace candidates include the existing canonical reconciliation", () => {
  for (const version of workspace) {
    assert.ok(entries.get(version).candidateSourceVersions.includes("20260904230332"));
  }
});

test("privilege candidates include the existing production privilege reconciliation", () => {
  for (const version of privileges) {
    assert.ok(entries.get(version).candidateSourceVersions.includes("20260904230329"));
  }
});

test("the only lineage changes are the fifteen reviewed candidate additions", () => {
  const restored = structuredClone(lineage);
  const additions = new Map([
    ...workspace.map((version) => [version, "20260904230332"]),
    ...privileges.map((version) => [version, "20260904230329"]),
  ]);
  for (const entry of restored.entries) {
    const candidate = additions.get(entry.remoteVersion);
    if (!candidate) continue;
    assert.equal(entry.candidateSourceVersions.filter((v) => v === candidate).length, 1);
    entry.candidateSourceVersions = entry.candidateSourceVersions.filter((v) => v !== candidate);
  }
  // Pin the semantic content of main's 3f155680... lineage blob. This preserves
  // the historical 93-source snapshot, all five equivalences, hashes, reasons,
  // safety notes, and every pre-existing candidate without relying on formatting.
  const digest = createHash("sha256").update(JSON.stringify(canonical(restored))).digest("hex");
  assert.equal(digest, "a8aadcc911f244b39d49c6b6028fdbde52a41398cc14d2e6103ae2f65a76818e");
});

test("the reviewed evidence distinguishes the historical and current-state baselines", () => {
  const report = readFileSync(
    "docs/release-reconciliation/remote-only-migrations-20260915.md",
    "utf8",
  );
  assert.match(report, /20260906024459/);
  assert.match(report, /20260903145843/);
  assert.match(report, /97-version baseline is not the 98-version current-state baseline/);
  assert.match(report, /No additional equivalence is proven/);
  const documented = [...report.matchAll(/^\| `(\d{14})` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...workspace, ...privileges, ...unchanged].sort());
});
