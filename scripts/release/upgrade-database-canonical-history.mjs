import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCanonicalHistoryDecision } from "./canonical-history-decision.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DECISION = "docs/release-reconciliation/canonical-history-actions-20260923.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const RECORD_ONLY = ["20260822122000", "20260823113000", "20260903145843"];
export const HISTORY_ONLY_SENTINEL = `do $kova_history_only$ begin
  raise exception 'upgrade_history_only_source_body_was_executed';
end $kova_history_only$;\n`;
const RECURRENCE_ARGUMENTS = "p_previous timestamp with time zone, p_repeat text";

// Consume only the strict, receipt-bound routine captures. A green local replay
// must identify a scheduled-function regression rather than imply that any
// proposed production history action is safe.
export function assessCanonicalScheduledRecurrence(baseline, final) {
  const matches = (capture) =>
    capture.routines.filter(
      (row) =>
        row.schema === "public" &&
        row.name === "next_scheduled_task_occurrence" &&
        row.identityArguments === RECURRENCE_ARGUMENTS,
    );
  const before = matches(baseline);
  const after = matches(final);
  if (before.length !== 1 || after.length !== 1)
    throw new Error("upgrade_canonical_scheduled_recurrence_missing");
  if (before[0].volatility !== "s") throw new Error("upgrade_canonical_scheduled_baseline_changed");
  return {
    routine: "public.next_scheduled_task_occurrence(timestamptz,text)",
    baselineVolatility: before[0].volatility,
    finalVolatility: after[0].volatility,
    bodySha256Unchanged: before[0].bodySha256 === after[0].bodySha256,
    volatilityDriftDetected: before[0].volatility !== after[0].volatility,
    proposedProductionSequenceApproved: false,
  };
}

// Rehearse the reviewed source inventory in a disposable database. The
// scheduled history-only action is provisional until its remote proofs pass.
export function extendProposedCanonicalHistory(
  plan,
  root = ROOT,
  readFile = readFileSync,
  readDirectory,
) {
  if (resolve(root) !== ROOT || plan.baseline.length !== 98 || !plan.currentHistory)
    throw new Error("upgrade_canonical_history_checkpoint_invalid");
  const decisionBytes = readFile(join(root, DECISION));
  const decision = buildCanonicalHistoryDecision({ root, readFile, readDirectory });
  if (JSON.stringify(JSON.parse(decisionBytes)) !== JSON.stringify(decision))
    throw new Error("upgrade_canonical_history_inventory_stale");
  if (
    decision.targetProjectRef !== plan.currentHistory.projectRef ||
    decision.capturedLedgerMetadataSha256 !== plan.currentHistory.ledgerMetadataSha256 ||
    decision.counts.conditionalForwardBodies !== 107 ||
    decision.counts.conditionalRecordOnlyVersions !== 4 ||
    decision.counts.proposedFinalLedgerCount !== 209
  )
    throw new Error("upgrade_canonical_history_inventory_mismatch");

  const pending = new Map(plan.forward.map((row) => [row.version, row]));
  if (pending.size !== 111 || decision.sourceOnly.length !== 111)
    throw new Error("upgrade_canonical_history_pending_mismatch");
  const recordOnly = [];
  const executionForward = [];
  for (const action of decision.sourceOnly) {
    const source = pending.get(action.version);
    if (
      !source ||
      source.sha256 !== action.sha256 ||
      action.path !== `supabase/migrations/${source.name}`
    )
      throw new Error("upgrade_canonical_history_source_mismatch");
    pending.delete(action.version);
    if (action.proposedAction === "record_canonical_version_without_rerunning_equivalent_body") {
      if (
        !Array.isArray(action.equivalentRemoteVersions) ||
        !action.equivalentRemoteVersions.some((version) =>
          decision.remoteOnly.some(
            (remote) =>
              remote.version === version &&
              remote.mappingStatus === "equivalent" &&
              (remote.capturedStatementsSha256 === source.sha256 ||
                (source.content.at(-1) === 10 &&
                  remote.capturedStatementsSha256 === sha256(source.content.subarray(0, -1)))),
          ),
        )
      )
        throw new Error("upgrade_canonical_history_equivalence_missing");
      recordOnly.push(source.version);
    } else if (action.proposedAction === "record_scheduled_version_pending_remote_effect_review") {
      if (
        source.version !== "20260822143000" ||
        JSON.stringify([...action.linkedRemoteOnlyVersions].sort()) !==
          JSON.stringify(["20260823092107", "20260823092450"]) ||
        decision.remoteOnly.filter(
          (remote) =>
            action.linkedRemoteOnlyVersions.includes(remote.version) &&
            remote.mappingStatus === "requires_schema_proof",
        ).length !== 2
      )
        throw new Error("upgrade_scheduled_history_review_required");
      // Strict statement validation below runs before withholding execution.
      executionForward.push(source);
    } else if (action.proposedAction === "execute_pinned_source_body_then_record_version") {
      executionForward.push(source);
    } else throw new Error("upgrade_canonical_history_action_invalid");
  }
  if (
    pending.size ||
    executionForward.length !== 108 ||
    JSON.stringify(recordOnly.sort()) !== JSON.stringify(RECORD_ONLY)
  )
    throw new Error("upgrade_canonical_history_action_counts_invalid");
  const original = {
    ...plan,
    pending: decision.sourceOnly.map((entry) => entry.path.slice("supabase/migrations/".length)),
    executionForward,
    recordOnlyVersions: recordOnly,
    canonicalHistoryProposal: {
      status: "synthetic_proposal_only_no_production_history_repair",
      inventorySha256: sha256(decisionBytes),
      capturedLedgerMetadataSha256: decision.capturedLedgerMetadataSha256,
      sourceMigrationTree: decision.sourceMigrationTree,
      recordOnlyVersions: recordOnly,
      historyOnlySentinelSha256: sha256(HISTORY_ONLY_SENTINEL),
      forwardVersions: executionForward.map((row) => row.version),
      deferredExtensionVersions: [],
      expectedFinalLedgerCount: decision.counts.proposedFinalLedgerCount,
      productionReleaseReady: false,
      productionRowsRestored: false,
      schemaProofsAccepted: false,
    },
  };
  const revised = extendScheduledRecordOnlyHypothesis(original);
  return {
    ...revised,
    canonicalHistoryProposal: {
      ...revised.canonicalHistoryProposal,
      status: "synthetic_revised_scheduled_proposal_pending_remote_effect_review",
    },
  };
}

// Explore one alternative in disposable PostgreSQL. The pinned second remote
// scheduled statement differs from this source by exactly one blank line
// outside a dollar-quoted body. This check does not prove the earlier remote
// statement, later grants, row compatibility, or production history action.
export function extendScheduledRecordOnlyHypothesis(plan) {
  if (
    plan.canonicalHistoryProposal?.status ===
      "synthetic_revised_scheduled_proposal_pending_remote_effect_review" &&
    plan.executionForward?.length === 107 &&
    plan.recordOnlyVersions?.length === 4
  )
    return {
      ...plan,
      canonicalHistoryProposal: {
        ...plan.canonicalHistoryProposal,
        status: "synthetic_scheduled_record_only_hypothesis_no_production_history_repair",
      },
    };
  if (
    plan.canonicalHistoryProposal?.status !==
      "synthetic_proposal_only_no_production_history_repair" ||
    plan.baseline?.length !== 98 ||
    plan.executionForward?.length !== 108 ||
    plan.recordOnlyVersions?.length !== 3
  )
    throw new Error("upgrade_scheduled_hypothesis_plan_invalid");
  const scheduled = plan.executionForward.filter((row) => row.version === "20260822143000");
  const remote = plan.baseline.filter((row) => row.version === "20260823092450");
  if (scheduled.length !== 1 || remote.length !== 1 || remote[0].statementCount !== 1)
    throw new Error("upgrade_scheduled_hypothesis_mapping_missing");
  const original = scheduled[0].content.toString("utf8");
  const beforeMarker = "\n\n-- DAY14_SETTLEMENT_CONTRACT_V1\n";
  const afterMarker = "\n-- DAY14_SETTLEMENT_CONTRACT_V1\n";
  if (original.split(beforeMarker).length !== 2)
    throw new Error("upgrade_scheduled_hypothesis_normalization_invalid");
  const normalized = Buffer.from(original.replace(beforeMarker, afterMarker));
  if (
    sha256(scheduled[0].content) !== scheduled[0].sha256 ||
    sha256(normalized) !== remote[0].capturedStatementsSha256 ||
    createHash("md5").update(normalized).digest("hex") !== remote[0].capturedStatementsMd5
  )
    throw new Error("upgrade_scheduled_hypothesis_statement_mismatch");

  const executionForward = plan.executionForward.filter((row) => row !== scheduled[0]);
  const recordOnlyVersions = [...plan.recordOnlyVersions, scheduled[0].version].sort();
  if (executionForward.length !== 107 || recordOnlyVersions.length !== 4)
    throw new Error("upgrade_scheduled_hypothesis_counts_invalid");
  return {
    ...plan,
    executionForward,
    recordOnlyVersions,
    canonicalHistoryProposal: {
      ...plan.canonicalHistoryProposal,
      status: "synthetic_scheduled_record_only_hypothesis_no_production_history_repair",
      recordOnlyVersions,
      forwardVersions: executionForward.map((row) => row.version),
      scheduledRecordOnlyHypothesis: {
        sourceVersion: scheduled[0].version,
        sourceSha256: scheduled[0].sha256,
        remoteVersion: remote[0].version,
        remoteCapturedStatementsSha256: remote[0].capturedStatementsSha256,
        difference: "one_blank_line_before_settlement_marker_outside_dollar_quote",
        firstRemoteScheduledVersionProven: false,
        sourceActionApproved: false,
      },
    },
  };
}

// A disposable counterfactual: preserve the first remote ledger version but
// replay a harmless statement in its place, then let the pinned second remote
// body and the 107+4 source sequence run as before. This can compare final
// scoped catalogs; it cannot prove what happened to production rows or grants.
export const FIRST_REMOTE_NOOP = "select 1;\n";
export function extendFirstRemoteScheduledOmission(plan) {
  if (
    plan.canonicalHistoryProposal?.status !==
      "synthetic_scheduled_record_only_hypothesis_no_production_history_repair" ||
    plan.baseline?.length !== 98 ||
    plan.executionForward?.length !== 107 ||
    plan.recordOnlyVersions?.length !== 4
  )
    throw new Error("upgrade_first_remote_omission_plan_invalid");
  const first = plan.baseline.filter((row) => row.version === "20260823092107");
  const second = plan.baseline.filter((row) => row.version === "20260823092450");
  if (
    first.length !== 1 ||
    second.length !== 1 ||
    first[0].origin !== "reviewed_structural_fixture" ||
    first[0].statementCount !== 1 ||
    first[0].sha256 !== "6dd86a55e89eeeacf8748e8a52cc4a0380e0e7d2c820a58cda6eb1ea07de9171" ||
    first[0].capturedStatementsSha256 !==
      "36c62ee32dad94f2940361030de17d29a7d32a2650e2462aee506b6b97530441" ||
    first[0].capturedStatementsMd5 !== "a0b35aef40ab1c251b7611aa596479a5" ||
    second[0].capturedStatementsSha256 !==
      "822e5dbc631673be4127994af60abc265f778ccb7ab703a4b02741bbb47f6190" ||
    sha256(first[0].content) !== first[0].sha256 ||
    sha256(second[0].content) !== second[0].sha256
  )
    throw new Error("upgrade_first_remote_omission_fixture_mismatch");
  const syntheticFixtureBodySubstitution = {
    version: first[0].version,
    originalFixtureSha256: first[0].sha256,
    originalCapturedStatementsSha256: first[0].capturedStatementsSha256,
    secondRemoteCapturedStatementsSha256: second[0].capturedStatementsSha256,
    substitutedStatementSha256: sha256(FIRST_REMOTE_NOOP),
    baselineMatchesCapturedStatements: false,
    firstRemoteEffectProven: false,
    sourceActionApproved: false,
  };
  return {
    ...plan,
    baseline: plan.baseline.map((row) =>
      row === first[0] ? { ...row, content: Buffer.from(FIRST_REMOTE_NOOP) } : row,
    ),
    syntheticFixtureBodySubstitution,
    canonicalHistoryProposal: {
      ...plan.canonicalHistoryProposal,
      status: "synthetic_first_remote_omission_no_production_history_repair",
      syntheticFixtureBodySubstitution,
    },
  };
}
