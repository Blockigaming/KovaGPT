import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ledgerMetadataHash } from "./upgrade-database-current-history.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sourcePath = "release-migrations.json";
const lineagePath = "release-migration-lineage.json";
const baselinePath = "tests/fixtures/production-migration-history-20260904/manifest.json";
const supplementPath =
  "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json";
const decisionPath = "docs/release-reconciliation/canonical-history-actions-20260923.json";

export function buildCanonicalHistoryDecision() {
  const source = read(sourcePath);
  const lineage = read(lineagePath);
  const baseline = read(baselinePath);
  const supplement = read(supplementPath);
  const sourceVersions = new Set(source.migrations.map((entry) => entry.timestamp));
  const remote = [
    ...baseline.migrations.map((entry) => ({ ...entry, provenance: "historical_fixture" })),
    ...supplement.supplement.map((entry) => ({
      version: entry.remoteVersion,
      path: supplementPath,
      sha256: sha256(readFileSync(supplementPath)),
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
        captured98RowRehearsal:
          entry.timestamp === "20260903145843"
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
    source.migrations.length !== 157 ||
    remote.length !== 98 ||
    sourceOnly.length !== 83 ||
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
  for (const entry of sourceOnly) {
    if (sha256(readFileSync(entry.path)) !== entry.sha256)
      throw new Error("canonical_history_source_hash_changed");
  }
  for (const entry of remoteOnly) {
    if (
      entry.provenance === "historical_fixture" &&
      sha256(readFileSync(entry.evidencePath)) !== entry.evidenceSha256
    )
      throw new Error("canonical_history_fixture_hash_changed");
  }
  return {
    schemaVersion: 1,
    status: "proposed_only_no_history_repair_or_production_action",
    targetProjectRef: supplement.projectRef,
    sourceCheckpointCommit: "5734b9e3d96224b06cdf2bc6f824078738b86ce1",
    sourceMigrationTree: "4af43abcf92f5a024ab33274d08855c6efbf3b15",
    sourceManifestSha256: sha256(readFileSync(sourcePath)),
    lineageSha256: sha256(readFileSync(lineagePath)),
    historicalFixtureManifestSha256: sha256(readFileSync(baselinePath)),
    currentSupplementSha256: sha256(readFileSync(supplementPath)),
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
  if (process.argv.includes("--write")) writeFileSync(decisionPath, expected);
  else if (process.argv.includes("--check")) {
    if (JSON.stringify(read(decisionPath)) !== JSON.stringify(JSON.parse(expected)))
      throw new Error("canonical_history_decision_stale");
  } else throw new Error("use --check or --write");
}
