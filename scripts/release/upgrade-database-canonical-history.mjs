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

// A separate, explicitly selected synthetic rehearsal of the proposed 108+3
// inventory. This function cannot repair a remote ledger or accept the plan.
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
    decision.counts.conditionalForwardBodies !== 108 ||
    decision.counts.conditionalRecordOnlyVersions !== 3 ||
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
  return {
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
}
