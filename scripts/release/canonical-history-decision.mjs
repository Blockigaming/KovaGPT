import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerMetadataHash } from "./upgrade-database-current-history.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourcePath = "release-migrations.json";
const lineagePath = "release-migration-lineage.json";
const baselinePath = "tests/fixtures/production-migration-history-20260904/manifest.json";
const supplementPath =
  "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json";
const decisionPath = "docs/release-reconciliation/canonical-history-actions-20260923.json";
const migrationTree = "f7bcced92e8abb546ac48b277df71bd16c6886b7";
const targetProjectRef = "mfbycmbjygcfkrsuepxf";
const capturedAtPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function validCapturedAt(value) {
  if (typeof value !== "string") return false;
  const parts = capturedAtPattern.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  )
    return false;
  const calendarDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return (
    Number.isFinite(calendarDate.getTime()) &&
    calendarDate.toISOString().slice(0, 10) === `${year}-${month}-${day}` &&
    Number.isFinite(Date.parse(value))
  );
}

export function validateCanonicalHistoryCapture(lineage, baseline, supplement, baselineSha256) {
  if (lineage.targetProjectRef !== targetProjectRef || supplement.projectRef !== targetProjectRef)
    throw new Error("canonical_history_target_mismatch");
  if (
    baseline.productionVersionCount !== 97 ||
    baseline.migrations?.length !== supplement.historicalVersionCount ||
    baseline.migrations.length !== 97 ||
    supplement.currentVersionCount !== 98 ||
    supplement.supplement?.length !== 1 ||
    supplement.readOnly !== true ||
    supplement.statementTextReturned !== false ||
    supplement.customerRowsReturned !== false ||
    !validCapturedAt(supplement.capturedAt)
  )
    throw new Error("canonical_history_capture_invalid");
  if (supplement.historicalManifestSha256 !== baselineSha256)
    throw new Error("canonical_history_historical_manifest_drift");
  if (supplement.historicalLedgerSha256 !== ledgerMetadataHash(baseline.migrations))
    throw new Error("canonical_history_historical_ledger_drift");
  if (
    baseline.migrations.reduce((sum, item) => sum + item.statementCount, 0) !==
      supplement.historicalStatementCount ||
    supplement.supplement[0].statementCount + supplement.historicalStatementCount !==
      supplement.currentStatementCount ||
    supplement.supplement[0].remoteVersion <= baseline.migrations.at(-1).version
  )
    throw new Error("canonical_history_capture_counts_mismatch");
}

export function validateCheckedOutMigrationSet(migrations, filenames, readBytes) {
  const expected = migrations.map((entry) => entry.filename);
  const actual = filenames.filter((name) => name.endsWith(".sql"));
  if (
    new Set(expected).size !== expected.length ||
    expected.length !== actual.length ||
    expected.some((name) => !actual.includes(name))
  )
    throw new Error("canonical_history_checked_out_migration_set_changed");
  for (const entry of migrations) {
    if (
      !/^\d{14}_.+\.sql$/u.test(entry.filename) ||
      entry.timestamp !== entry.filename.slice(0, 14) ||
      sha256(readBytes(entry.filename)) !== entry.sha256
    )
      throw new Error("canonical_history_checked_out_migration_content_changed");
  }
}

export function validateEquivalentSupplement(supplement, sourceMigration, sourceBytes) {
  const entry = supplement.supplement[0];
  if (
    !sourceMigration ||
    sourceMigration.timestamp !== "20260903145843" ||
    entry.remoteVersion !== "20260906024459" ||
    entry.sourceVersion !== sourceMigration.timestamp ||
    entry.sourcePath !== `supabase/migrations/${sourceMigration.filename}` ||
    entry.name !== "remediate_security_advisor_warnings" ||
    entry.comparison !== "exact-content-single-statement" ||
    entry.statementCount !== 1 ||
    entry.statementBytes !== sourceBytes.length ||
    entry.capturedStatementsSha256 !== sourceMigration.sha256 ||
    entry.capturedStatementsSha256 !== sha256(sourceBytes) ||
    entry.capturedStatementsMd5 !== createHash("md5").update(sourceBytes).digest("hex")
  )
    throw new Error("canonical_history_supplement_equivalence_changed");
}

export function buildCanonicalHistoryDecision({
  root = ROOT,
  readFile = readFileSync,
  readDirectory = readdirSync,
} = {}) {
  const repositoryRoot = resolve(root);
  const bytes = (path) => readFile(join(repositoryRoot, path));
  const json = (path) => JSON.parse(bytes(path).toString("utf8"));
  if (
    execFileSync("git", ["rev-parse", "HEAD:supabase/migrations"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim() !== migrationTree
  )
    throw new Error("canonical_history_migration_tree_changed");
  const source = json(sourcePath);
  const lineage = json(lineagePath);
  const baseline = json(baselinePath);
  const supplement = json(supplementPath);
  validateCanonicalHistoryCapture(lineage, baseline, supplement, sha256(bytes(baselinePath)));
  validateCheckedOutMigrationSet(
    source.migrations,
    readDirectory(join(repositoryRoot, "supabase/migrations")),
    (filename) => bytes(`supabase/migrations/${filename}`),
  );
  const securitySource = source.migrations.find((entry) => entry.timestamp === "20260903145843");
  if (!securitySource) throw new Error("canonical_history_security_source_missing");
  validateEquivalentSupplement(
    supplement,
    securitySource,
    bytes(`supabase/migrations/${securitySource.filename}`),
  );
  const sourceVersions = new Set(source.migrations.map((entry) => entry.timestamp));
  const remote = [
    ...baseline.migrations.map((entry) => ({ ...entry, provenance: "historical_fixture" })),
    ...supplement.supplement.map((entry) => ({
      version: entry.remoteVersion,
      path: supplementPath,
      sha256: sha256(bytes(supplementPath)),
      capturedStatementsSha256: entry.capturedStatementsSha256,
      capturedStatementsMd5: entry.capturedStatementsMd5,
      statementCount: entry.statementCount,
      provenance: "read_only_98th_row_supplement",
    })),
  ];
  const remoteVersions = new Set(remote.map((entry) => entry.version));
  const linkedRemote = (version) =>
    lineage.entries
      .filter(
        (entry) =>
          entry.sourceVersion === version || entry.candidateSourceVersions?.includes(version),
      )
      .map((entry) => entry.remoteVersion);
  const sourceOnly = source.migrations
    .filter((entry) => !remoteVersions.has(entry.timestamp))
    .map((entry) => {
      const matches = lineage.entries.filter(
        (remoteEntry) =>
          remoteEntry.status === "equivalent" && remoteEntry.sourceVersion === entry.timestamp,
      );
      return {
        version: entry.timestamp,
        path: `supabase/migrations/${entry.filename}`,
        sha256: entry.sha256,
        linkedRemoteOnlyVersions: linkedRemote(entry.timestamp),
        proposedAction: matches.length
          ? "record_canonical_version_without_rerunning_equivalent_body"
          : "execute_pinned_source_body_then_record_version",
        equivalentRemoteVersions: matches.map((match) => match.remoteVersion),
        manifestDataBackfillFlag: entry.dataBackfill,
        manifestDestructiveFlag: entry.destructive,
        requiredPrestateEvidence: matches.length
          ? "fresh_ledger_and_equivalent_remote_body_and_scoped_live_effect"
          : "fresh_ledger_and_exact_prior_schema_data_acl_rls_function_state",
        requiredDataReview:
          "migration_specific_before_after_transformations_and_no_unintended_loss",
        requiredValidation: "exact_ledger_delta_and_scoped_catalog_and_synthetic_two_user_contract",
        requiredRecoveryGate: "verified_actual_backup_restore_and_approved_rollback",
        // The pinned 158-file tree includes this migration after the hosted
        // 157-file replay; the older receipt cannot cover its effects.
        captured98RowRehearsal:
          entry.timestamp === "20260925000821"
            ? "not_rehearsed_in_historical_98_row_upgrade"
            : entry.timestamp === "20260903145843"
              ? "body_executed_in_baseline_under_remote_version"
              : "body_replayed_forward_in_isolated_database",
        reviewStatus: "blocked_pending_per_version_prestate_and_effect_review",
        expectedLedgerAddition: entry.timestamp,
      };
    });
  const remoteOnly = remote
    .filter((entry) => !sourceVersions.has(entry.version))
    .map((entry) => {
      const mapping = lineage.entries.find((item) => item.remoteVersion === entry.version);
      return {
        version: entry.version,
        name: mapping?.remoteName,
        capturedStatementCount: entry.statementCount,
        capturedStatementsSha256: entry.capturedStatementsSha256,
        capturedStatementsMd5: entry.capturedStatementsMd5,
        evidencePath: entry.path,
        evidenceSha256: entry.sha256,
        provenance: entry.provenance,
        mappedSourceVersion: mapping?.sourceVersion ?? null,
        candidateSourceVersions: mapping?.candidateSourceVersions ?? [],
        mappingStatus: mapping?.status,
        proposedAction: "retain_remote_history_row",
        reviewStatus:
          mapping?.status === "equivalent"
            ? "content_equivalence_only_history_action_unapproved"
            : "blocked_requires_schema_proof",
      };
    });
  if (
    source.migrations.length !== 158 ||
    remote.length !== 98 ||
    sourceOnly.length !== 84 ||
    remoteOnly.length !== 24 ||
    remoteOnly.filter((entry) => entry.mappingStatus === "equivalent").length !== 5 ||
    remoteOnly.filter((entry) => entry.mappingStatus === "requires_schema_proof").length !== 19 ||
    sourceOnly.filter((entry) => entry.equivalentRemoteVersions.length).length !== 3 ||
    lineage.entries.length !== remoteOnly.length ||
    new Set(sourceOnly.map((entry) => entry.version)).size !== sourceOnly.length ||
    new Set(remoteOnly.map((entry) => entry.version)).size !== remoteOnly.length ||
    remoteOnly.some((entry) => !entry.name || !entry.mappingStatus)
  )
    throw new Error("canonical_history_inventory_changed");
  for (const entry of remoteOnly) {
    if (
      entry.provenance === "historical_fixture" &&
      sha256(bytes(entry.evidencePath)) !== entry.evidenceSha256
    )
      throw new Error("canonical_history_fixture_hash_changed");
  }
  return {
    schemaVersion: 1,
    status: "proposed_only_no_history_repair_or_production_action",
    targetProjectRef: supplement.projectRef,
    sourceCheckpointCommit: "2d8ad886b7b201aaf87beecb4d5b5f75df009cac",
    sourceMigrationTree: migrationTree,
    sourceManifestSha256: sha256(bytes(sourcePath)),
    lineageSha256: sha256(bytes(lineagePath)),
    historicalFixtureManifestSha256: sha256(bytes(baselinePath)),
    currentSupplementSha256: sha256(bytes(supplementPath)),
    capturedLedgerMetadataSha256: ledgerMetadataHash(
      remote.map((entry) => ({
        version: entry.version,
        statementCount: entry.statementCount,
        capturedStatementsSha256: entry.capturedStatementsSha256,
        capturedStatementsMd5: entry.capturedStatementsMd5,
      })),
    ),
    capturedAt: supplement.capturedAt,
    counts: {
      shared: 74,
      remoteOnly: remoteOnly.length,
      sourceOnly: sourceOnly.length,
      equivalentRemoteRows: remoteOnly.filter((entry) => entry.mappingStatus === "equivalent")
        .length,
      blockedRemoteRows: remoteOnly.filter(
        (entry) => entry.mappingStatus === "requires_schema_proof",
      ).length,
      conditionalForwardBodies: sourceOnly.filter(
        (entry) => entry.proposedAction === "execute_pinned_source_body_then_record_version",
      ).length,
      conditionalRecordOnlyVersions: sourceOnly.filter(
        (entry) =>
          entry.proposedAction === "record_canonical_version_without_rerunning_equivalent_body",
      ).length,
      proposedFinalLedgerCount: remote.length + sourceOnly.length,
    },
    remoteOnly,
    sourceOnly,
  };
}

if (process.argv[1]?.endsWith("canonical-history-decision.mjs")) {
  const expected = `${JSON.stringify(buildCanonicalHistoryDecision(), null, 2)}\n`;
  if (process.argv.includes("--write")) writeFileSync(join(ROOT, decisionPath), expected);
  else if (process.argv.includes("--check")) {
    if (JSON.stringify(read(join(ROOT, decisionPath))) !== JSON.stringify(JSON.parse(expected)))
      throw new Error("canonical_history_decision_stale");
  } else throw new Error("use --check or --write");
}
