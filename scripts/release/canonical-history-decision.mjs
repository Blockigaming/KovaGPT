import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The 157-migration decision is a historical proposal, not an approval to
// repair a remote ledger. Auth migrations extend that exact source snapshot.
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CHECKPOINT = "5734b9e3d96224b06cdf2bc6f824078738b86ce1";
const DECISION_COMMIT = "bd0d2878ea41b4972bae13494288bd15c24b51aa";
const MIGRATION_TREE = "4af43abcf92f5a024ab33274d08855c6efbf3b15";
const DECISION_SHA256 = "6c0aa894709e131dade3c93e3597fbd45c3a55ec8cdde8130babfdfb34552df0";
const DECISION_PATH = "docs/release-reconciliation/canonical-history-actions-20260923.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pinned = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT });
const checkedOut = (path) => readFileSync(resolve(ROOT, path));

export function validateForwardExtension(baseline, current, filenames, readMigration) {
  if (
    baseline.count !== baseline.migrations?.length ||
    current.count !== current.migrations?.length ||
    current.migrations.length < baseline.migrations.length ||
    JSON.stringify(current.migrations.slice(0, baseline.count)) !==
      JSON.stringify(baseline.migrations) ||
    new Set(current.migrations.map((entry) => entry.filename)).size !== current.count ||
    JSON.stringify(filenames.filter((name) => name.endsWith(".sql")).sort()) !==
      JSON.stringify(current.migrations.map((entry) => entry.filename).sort())
  )
    throw new Error("canonical_history_source_set_changed");
  for (const [index, entry] of current.migrations.entries()) {
    if (
      !/^\d{14}_[a-zA-Z0-9_-]+\.sql$/u.test(entry.filename) ||
      entry.timestamp !== entry.filename.slice(0, 14) ||
      entry.order !== index + 1 ||
      (index > 0 && entry.timestamp <= current.migrations[index - 1].timestamp) ||
      (index >= baseline.count && !entry.filename.includes("_kova_")) ||
      sha256(readMigration(entry.filename)) !== entry.sha256
    )
      throw new Error("canonical_history_source_content_changed");
  }
}

export function checkCanonicalHistoryExtension() {
  const decisionBytes = pinned(DECISION_COMMIT, DECISION_PATH);
  if (sha256(decisionBytes) !== DECISION_SHA256)
    throw new Error("canonical_history_pinned_decision_changed");
  const decision = JSON.parse(decisionBytes);
  const baselineBytes = pinned(CHECKPOINT, "release-migrations.json");
  const lineageBytes = pinned(CHECKPOINT, "release-migration-lineage.json");
  const tree = execFileSync("git", ["rev-parse", `${CHECKPOINT}:supabase/migrations`], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (
    tree !== MIGRATION_TREE ||
    decision.sourceMigrationTree !== tree ||
    decision.sourceCheckpointCommit !== CHECKPOINT ||
    decision.sourceManifestSha256 !== sha256(baselineBytes) ||
    decision.lineageSha256 !== sha256(lineageBytes) ||
    decision.status !== "proposed_only_no_history_repair_or_production_action" ||
    decision.targetProjectRef !== "mfbycmbjygcfkrsuepxf" ||
    decision.counts?.blockedRemoteRows !== 19
  )
    throw new Error("canonical_history_pinned_snapshot_changed");

  const lineage = JSON.parse(lineageBytes);
  const currentLineage = JSON.parse(checkedOut("release-migration-lineage.json"));
  if (
    currentLineage.targetProjectRef !== lineage.targetProjectRef ||
    JSON.stringify(currentLineage.entries) !== JSON.stringify(lineage.entries)
  )
    throw new Error("canonical_history_remote_lineage_changed");
  for (const [path, expected] of [
    [
      "tests/fixtures/production-migration-history-20260904/manifest.json",
      decision.historicalFixtureManifestSha256,
    ],
    [
      "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json",
      decision.currentSupplementSha256,
    ],
    ...decision.remoteOnly
      .filter((entry) => entry.provenance === "historical_fixture")
      .map((entry) => [entry.evidencePath, entry.evidenceSha256]),
  ]) {
    if (sha256(checkedOut(path)) !== expected)
      throw new Error("canonical_history_remote_evidence_changed");
  }

  const baseline = JSON.parse(baselineBytes);
  const current = JSON.parse(checkedOut("release-migrations.json"));
  validateForwardExtension(
    baseline,
    current,
    readdirSync(resolve(ROOT, "supabase/migrations")),
    (filename) => checkedOut(`supabase/migrations/${filename}`),
  );
  return { baselineMigrations: baseline.count, forwardExtensions: current.count - baseline.count };
}

if (process.argv[1]?.endsWith("canonical-history-decision.mjs")) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check") throw new Error("use --check");
  console.log(JSON.stringify(checkCanonicalHistoryExtension()));
}
