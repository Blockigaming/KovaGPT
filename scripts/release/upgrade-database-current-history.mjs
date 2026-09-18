import { createHash } from "node:crypto";

export const CURRENT_HISTORY_SNAPSHOT =
  "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json";
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^\d{14}$/u;
const projectRef = "mfbycmbjygcfkrsuepxf";

export function ledgerMetadataHash(rows) {
  let previous = "";
  const lines = rows.map((row) => {
    if (
      !versionPattern.test(row.version ?? "") ||
      row.version <= previous ||
      !Number.isSafeInteger(row.statementCount) ||
      row.statementCount < 1 ||
      !hashPattern.test(row.capturedStatementsSha256 ?? "") ||
      !/^[a-f0-9]{32}$/u.test(row.capturedStatementsMd5 ?? "")
    )
      throw new Error("upgrade_current_history_metadata_invalid");
    previous = row.version;
    return [
      row.version,
      row.statementCount,
      row.capturedStatementsSha256,
      row.capturedStatementsMd5,
    ].join("|");
  });
  return digest("sha256", lines.join("\n"));
}

// This extends a validated historical source plan. It never fetches or changes
// production, reads a backup, repairs history, or marks canonical versions applied.
export function extendCurrentHistory(plan, snapshotBytes) {
  const snapshot = JSON.parse(snapshotBytes);
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot.projectRef !== projectRef ||
    snapshot.historicalVersionCount !== 97 ||
    snapshot.currentVersionCount !== 98 ||
    snapshot.historicalStatementCount !== 1042 ||
    snapshot.currentStatementCount !== 1043 ||
    typeof snapshot.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
    snapshot.readOnly !== true ||
    snapshot.statementTextReturned !== false ||
    snapshot.customerRowsReturned !== false ||
    !hashPattern.test(snapshot.historicalManifestSha256 ?? "") ||
    !hashPattern.test(snapshot.historicalLedgerSha256 ?? "") ||
    !Array.isArray(snapshot.supplement) ||
    snapshot.supplement.length !== 1
  )
    throw new Error("upgrade_current_history_snapshot_invalid");
  if (
    plan.baseline.length !== snapshot.historicalVersionCount ||
    plan.baselineSha256 !== snapshot.historicalManifestSha256 ||
    plan.baseline.reduce((sum, row) => sum + row.statementCount, 0) !==
      snapshot.historicalStatementCount ||
    ledgerMetadataHash(plan.baseline) !== snapshot.historicalLedgerSha256
  )
    throw new Error("upgrade_current_history_historical_drift");

  const entry = snapshot.supplement[0];
  if (
    !entry ||
    entry.remoteVersion !== "20260906024459" ||
    entry.sourceVersion !== "20260903145843" ||
    entry.name !== "remediate_security_advisor_warnings" ||
    entry.sourcePath !==
      "supabase/migrations/20260903145843_remediate_security_advisor_warnings.sql" ||
    entry.statementCount !== 1 ||
    !Number.isSafeInteger(entry.statementBytes) ||
    entry.statementBytes < 1 ||
    !hashPattern.test(entry.capturedStatementsSha256 ?? "") ||
    !/^[a-f0-9]{32}$/u.test(entry.capturedStatementsMd5 ?? "") ||
    entry.comparison !== "exact-content-single-statement" ||
    entry.remoteVersion <= plan.baseline.at(-1).version ||
    plan.baseline.some((row) => row.version === entry.remoteVersion) ||
    plan.forward.some((row) => row.version === entry.remoteVersion)
  )
    throw new Error("upgrade_current_history_supplement_invalid");
  const matches = plan.forward.filter((row) => row.version === entry.sourceVersion);
  if (matches.length !== 1) throw new Error("upgrade_current_history_source_missing");
  const source = matches[0];
  if (
    `supabase/migrations/${source.name}` !== entry.sourcePath ||
    !Buffer.isBuffer(source.content) ||
    source.content.length !== entry.statementBytes ||
    source.sha256 !== entry.capturedStatementsSha256 ||
    digest("sha256", source.content) !== entry.capturedStatementsSha256 ||
    digest("md5", source.content) !== entry.capturedStatementsMd5
  )
    throw new Error("upgrade_current_history_source_mismatch");

  const baseline = [
    ...plan.baseline,
    {
      version: entry.remoteVersion,
      path: entry.sourcePath,
      replayName: `${entry.remoteVersion}_${entry.name}.sql`,
      sha256: source.sha256,
      statementCount: entry.statementCount,
      capturedStatementsSha256: entry.capturedStatementsSha256,
      capturedStatementsMd5: entry.capturedStatementsMd5,
      origin: "content_equivalent_remote_supplement",
      content: source.content,
    },
  ];
  const currentStatementCount = baseline.reduce((sum, row) => sum + row.statementCount, 0);
  if (
    baseline.length !== snapshot.currentVersionCount ||
    currentStatementCount !== snapshot.currentStatementCount
  )
    throw new Error("upgrade_current_history_count_mismatch");
  return {
    ...plan,
    baseline,
    // Keep the canonical source in forward: copying an equivalent remote row is
    // not permission to mark the unexecuted canonical timestamp as applied.
    currentHistory: {
      capturedAt: snapshot.capturedAt,
      projectRef,
      historicalManifestSha256: plan.baselineSha256,
      supplementSha256: digest("sha256", snapshotBytes),
      ledgerMetadataSha256: ledgerMetadataHash(baseline),
      baselineVersions: baseline.length,
      baselineStatementCount: currentStatementCount,
      productionRowsRestored: false,
      liveCatalogEquivalenceProven: false,
    },
  };
}
