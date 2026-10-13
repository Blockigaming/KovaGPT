import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { buildCanonicalHistoryDecision } from "../../scripts/release/canonical-history-decision.mjs";
import { extendProposedCanonicalHistory } from "../../scripts/release/upgrade-database-canonical-history.mjs";
import { planUpgrade } from "../../scripts/release/upgrade-database.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = join(ROOT, "tests/fixtures/release-forward-candidates");
const meta = JSON.parse(readFileSync(join(FIXTURE, "manifest.json")));
const hash = (v) => createHash("sha256").update(v).digest("hex");
const original = JSON.parse(
  execFileSync(
    "git",
    ["show", "3ffdde6fe80e6511ab1e2f76b405c71a2858edfd:release-migrations.json"],
    { cwd: ROOT, timeout: 10000 },
  ),
);
const originalDecision = JSON.parse(
  readFileSync(join(ROOT, "docs/release-reconciliation/canonical-history-actions-20260923.json")),
);
const { format, resolveConfig } = createRequire(import.meta.url)("prettier");
const formatOptions = {
  ...(await resolveConfig(join(ROOT, "release-migrations.json"))),
  parser: "json",
};
const formatted = new Map();
for (const kind of ["auth", "interface", "combined"]) {
  const entries =
    kind === "auth"
      ? meta.extensions.slice(0, 3)
      : kind === "interface"
        ? meta.extensions.slice(3)
        : meta.extensions;
  const migrations = [...original.migrations, ...entries].map((v, i) => ({ ...v, order: i + 1 }));
  const manifest = {
    ...original,
    count: migrations.length,
    latest: migrations.at(-1).filename,
    migrations,
  };
  formatted.set(kind, Buffer.from(await format(JSON.stringify(manifest), formatOptions)));
}

function candidate(kind) {
  const entries =
    kind === "auth"
      ? meta.extensions.slice(0, 3)
      : kind === "interface"
        ? meta.extensions.slice(3)
        : meta.extensions;
  const migrations = [...original.migrations, ...entries].map((v, i) => ({ ...v, order: i + 1 }));
  const manifest = {
    ...original,
    count: migrations.length,
    latest: migrations.at(-1).filename,
    migrations,
  };
  const files = new Map([
    [resolve(ROOT, "release-migrations.json"), formatted.get(kind)],
    ...entries.map((e) => [
      resolve(ROOT, "supabase/migrations", e.filename),
      readFileSync(join(FIXTURE, e.filename)),
    ]),
  ]);
  const readFile = (p) => files.get(resolve(p)) ?? readFileSync(p);
  const readDirectory = (p) =>
    resolve(p) === resolve(ROOT, "supabase/migrations")
      ? [...original.migrations.map((e) => e.filename), ...entries.map((e) => e.filename)]
      : readdirSync(p);
  const decision = () => buildCanonicalHistoryDecision({ root: ROOT, readFile, readDirectory });
  const plan = () =>
    extendCurrentHistory(
      planUpgrade(ROOT, readFile, readDirectory),
      readFile(join(ROOT, CURRENT_HISTORY_SNAPSHOT)),
    );
  const extend = (p = plan()) => extendProposedCanonicalHistory(p, ROOT, readFile, readDirectory);
  return { entries, manifest, files, readFile, decision, plan, extend };
}

test("fixtures are exact public source copies, not historical migrations", () => {
  for (const e of meta.extensions) {
    assert.equal(hash(readFileSync(join(FIXTURE, e.filename))), e.sha256);
    assert.equal(
      original.migrations.some((m) => m.timestamp === e.timestamp),
      false,
    );
  }
});

for (const [kind, count, binding] of [
  ["auth", 188, "authCandidateManifestSha256"],
  ["interface", 186, "interfaceManifestSha256"],
  ["combined", 189, "combinedManifestSha256"],
]) {
  test(`${kind}: exact candidate preserves immutable historical decision and defers new bodies`, () => {
    const c = candidate(kind);
    assert.equal(c.manifest.count, count);
    assert.equal(hash(c.readFile(join(ROOT, "release-migrations.json"))), meta[binding]);
    assert.deepEqual(c.decision(), originalDecision);
    const result = c.extend();
    assert.equal(result.pending.length, 111);
    assert.equal(result.executionForward.length, 107);
    assert.equal(result.recordOnlyVersions.length, 4);
    assert.equal(result.canonicalHistoryProposal.expectedFinalLedgerCount, 209);
    assert.deepEqual(
      result.canonicalHistoryProposal.deferredExtensionVersions,
      c.entries.map((e) => e.timestamp),
    );
    assert.equal(result.canonicalHistoryProposal.schemaProofsAccepted, false);
    assert.equal(result.canonicalHistoryProposal.productionReleaseReady, false);
    assert.ok(
      c.entries.every((e) => !result.executionForward.some((v) => v.version === e.timestamp)),
    );
  });
}

test("unreviewed combined manifest metadata cannot impersonate the pinned candidate", () => {
  const c = candidate("combined");
  c.manifest.migrations.at(-1).destructive = false;
  c.files.set(resolve(ROOT, "release-migrations.json"), Buffer.from(JSON.stringify(c.manifest)));
  assert.throws(c.decision, /canonical_history_current_source_checkpoint_changed/u);
});

for (const i of [0, 1, 2, 3]) {
  test(`changed forward body ${i} fails before any execution`, () => {
    const c = candidate("combined");
    const e = c.entries[i];
    c.files.set(resolve(ROOT, "supabase/migrations", e.filename), Buffer.from("-- unreviewed\n"));
    assert.throws(c.decision, /canonical_history_checked_out_migration_content_changed/u);
  });
}

test("partial Auth deferral and pending-content tamper are rejected", () => {
  const c = candidate("combined");
  const partial = c.plan();
  partial.forward = partial.forward.filter((e) => e.version !== "20260930224000");
  assert.throws(() => c.extend(partial), /upgrade_canonical_history_extension_incomplete/u);
  const bad = c.plan();
  bad.forward.find((e) => e.version === "20261008153032").content = Buffer.from("-- changed\n");
  assert.throws(() => c.extend(bad), /upgrade_canonical_history_extension_mismatch/u);
});

test("185-source historical decision remains byte-semantically unchanged", () => {
  assert.deepEqual(buildCanonicalHistoryDecision(), originalDecision);
  assert.equal(original.count, 185);
});
