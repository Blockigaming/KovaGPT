import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHAT_WORKSPACE_TABLE_FILE,
  CHAT_WORKSPACE_TABLE_QUERY_SHA256,
  buildChatWorkspaceTableEvidence,
} from "./upgrade-database-chat-workspace-tables.mjs";
import {
  CHAT_WORKSPACE_CATALOG_FILE,
  CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
  buildChatWorkspaceCatalogEvidence,
} from "./upgrade-database-chat-workspace-routines.mjs";
import {
  DAY15_CHAT_DATA_QUERY_SHA256,
  validateDay15ChatDataViolations,
} from "./day15-chat-data-violations.mjs";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => {
  throw new Error(`chat_workspace_live_comparison_${reason}`);
};

function readJson(path) {
  let bytes;
  try {
    bytes = readFileSync(resolve(path));
  } catch {
    fail("file_unavailable");
  }
  if (bytes.length < 2 || bytes.length > 2 * 1024 * 1024) fail("file_size_invalid");
  try {
    return { data: JSON.parse(bytes.toString("utf8")), sha256: digest(bytes) };
  } catch {
    fail("json_invalid");
  }
}

function checkedArtifact(receipt, key, path, file, querySha256, kind, build) {
  const pointer = receipt[key];
  if (
    !pointer ||
    basename(resolve(path)) !== file ||
    pointer.file !== file ||
    !SHA256.test(pointer.sha256 ?? "") ||
    pointer.querySha256 !== querySha256
  )
    fail("receipt_invalid");
  const artifact = readJson(path);
  const data = artifact.data;
  if (
    artifact.sha256 !== pointer.sha256 ||
    data.captureKind !== kind ||
    data.querySha256 !== querySha256 ||
    data.sourceCommit !== receipt.sourceCommit ||
    !SHA40.test(data.sourceTree ?? "") ||
    data.schemaProofPromoted !== false ||
    data.productionReleaseReady !== false ||
    data.baseline?.capture?.ledgerVersionCount !== receipt.baselineVersions
  )
    fail("artifact_invalid");
  const verified = build({
    baseline: data.baseline.capture,
    upgraded: data.upgraded.capture,
    baselineVersions: data.baseline.capture.ledgerVersions,
    finalVersions: data.upgraded.capture.ledgerVersions,
    sourceCommit: data.sourceCommit,
    sourceTree: data.sourceTree,
  });
  if (
    JSON.stringify(verified.baseline.fingerprint) !== JSON.stringify(data.baseline.fingerprint) ||
    JSON.stringify(verified.upgraded.fingerprint) !== JSON.stringify(data.upgraded.fingerprint) ||
    JSON.stringify(verified.changes) !== JSON.stringify(data.changes) ||
    verified.querySha256 !== data.querySha256
  )
    fail("artifact_fingerprint_mismatch");
  return artifact;
}

function compareScope(artifact, live, build) {
  const source = artifact.data;
  const snapshot = live.data;
  if (
    Date.parse(snapshot.capturedAt) < Date.parse(source.upgraded.capture.capturedAt) ||
    JSON.stringify(snapshot.ledgerVersions) !==
      JSON.stringify(source.baseline.capture.ledgerVersions)
  )
    fail("live_checkpoint_mismatch");
  const before = build({
    baseline: source.baseline.capture,
    upgraded: snapshot,
    baselineVersions: source.baseline.capture.ledgerVersions,
    finalVersions: snapshot.ledgerVersions,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
  });
  const after = build({
    baseline: source.upgraded.capture,
    upgraded: snapshot,
    baselineVersions: source.upgraded.capture.ledgerVersions,
    finalVersions: snapshot.ledgerVersions,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
  });
  return {
    querySha256: source.querySha256,
    artifactSha256: artifact.sha256,
    liveCaptureSha256: live.sha256,
    capturedAt: snapshot.capturedAt,
    baselineVsLive: before.changes,
    sourceFinalVsLive: after.changes,
    baselineFingerprint: before.baseline.fingerprint,
    sourceFinalFingerprint: after.baseline.fingerprint,
    liveFingerprint: before.upgraded.fingerprint,
  };
}

export function compareLiveChatWorkspaceCatalog({
  receiptPath,
  tableArtifactPath,
  routineArtifactPath,
  liveTablePath,
  liveRoutinePath,
  liveDataPath,
}) {
  const receipt = readJson(receiptPath).data;
  if (
    receipt.passed !== true ||
    receipt.executed !== true ||
    !SHA40.test(receipt.sourceCommit ?? "") ||
    receipt.currentHistory?.requiresCanonicalHistoryReconciliation !== true ||
    receipt.currentHistory?.productionReleaseReady !== false
  )
    fail("receipt_invalid");
  const tables = checkedArtifact(
    receipt,
    "chatWorkspaceTables",
    tableArtifactPath,
    CHAT_WORKSPACE_TABLE_FILE,
    CHAT_WORKSPACE_TABLE_QUERY_SHA256,
    "chat-workspace-table-checkpoints",
    buildChatWorkspaceTableEvidence,
  );
  const routines = checkedArtifact(
    receipt,
    "chatWorkspaceRoutines",
    routineArtifactPath,
    CHAT_WORKSPACE_CATALOG_FILE,
    CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
    "chat-workspace-routine-checkpoints",
    buildChatWorkspaceCatalogEvidence,
  );
  if (
    tables.data.sourceTree !== routines.data.sourceTree ||
    JSON.stringify(tables.data.baseline.capture.ledgerVersions) !==
      JSON.stringify(routines.data.baseline.capture.ledgerVersions) ||
    JSON.stringify(tables.data.upgraded.capture.ledgerVersions) !==
      JSON.stringify(routines.data.upgraded.capture.ledgerVersions)
  )
    fail("source_checkpoint_mismatch");
  const liveTable = readJson(liveTablePath),
    liveRoutine = readJson(liveRoutinePath),
    liveData = readJson(liveDataPath);
  if (
    JSON.stringify(liveTable.data.ledgerVersions) !==
      JSON.stringify(liveRoutine.data.ledgerVersions) ||
    liveData.data.querySha256 !== DAY15_CHAT_DATA_QUERY_SHA256
  )
    fail("live_checkpoint_mismatch");
  const counts = validateDay15ChatDataViolations(liveData.data.counts);
  if (
    liveData.data.observedViolationCount !== counts.observedViolationCount ||
    liveData.data.schemaProofPromoted !== false ||
    liveData.data.productionReleaseReady !== false
  )
    fail("live_data_invalid");
  return {
    schemaVersion: 1,
    captureKind: "chat-workspace-live-catalog-comparison",
    sourceCommit: receipt.sourceCommit,
    sourceTree: tables.data.sourceTree,
    liveLedgerVersionCount: liveTable.data.ledgerVersionCount,
    tables: compareScope(tables, liveTable, buildChatWorkspaceTableEvidence),
    routines: compareScope(routines, liveRoutine, buildChatWorkspaceCatalogEvidence),
    liveData: {
      querySha256: counts.querySha256,
      captureSha256: liveData.sha256,
      observedViolationCount: counts.observedViolationCount,
    },
    liveCatalogCompared: true,
    schemaProofPromoted: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
    limitations: [
      "The source replay is isolated; these live reads and data counts occurred separately. Concurrent changes between captures cannot be excluded.",
      "Table metadata and selected routine-name families are covered. Other dependencies, views and executable behavior need their own scope and synthetic tests.",
      "No mapping is promoted; a current checkpoint, later-writer review, full scope, independent acceptance and restore evidence are required.",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 8) fail("usage");
  console.log(
    JSON.stringify(
      compareLiveChatWorkspaceCatalog({
        receiptPath: process.argv[2],
        tableArtifactPath: process.argv[3],
        routineArtifactPath: process.argv[4],
        liveTablePath: process.argv[5],
        liveRoutinePath: process.argv[6],
        liveDataPath: process.argv[7],
      }),
      null,
      2,
    ),
  );
}
