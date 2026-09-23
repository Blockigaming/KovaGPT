import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEMP_EXPORT_PROOF_FILE,
  TEMP_EXPORT_PROOF_ID,
  TEMP_EXPORT_QUERY_SHA256,
  temporaryExportSnapshot,
} from "./upgrade-database-temp-export-proof.mjs";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(reason) {
  throw new Error(`temp_export_live_comparison_${reason}`);
}

function readJson(path) {
  let bytes;
  try {
    bytes = readFileSync(resolve(path));
  } catch {
    fail("file_unavailable");
  }
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) fail("file_size_invalid");
  try {
    return { data: JSON.parse(bytes.toString("utf8")), sha256: digest(bytes) };
  } catch {
    fail("json_invalid");
  }
}

export function compareLiveTemporaryExportCatalog({ receiptPath, artifactPath, livePath }) {
  const receipt = readJson(receiptPath).data;
  const pointer = receipt?.temporaryExportProof;
  if (
    receipt?.passed !== true ||
    receipt?.executed !== true ||
    !SHA40.test(receipt?.sourceCommit ?? "") ||
    receipt?.currentHistory?.requiresCanonicalHistoryReconciliation !== true ||
    receipt?.currentHistory?.productionReleaseReady !== false ||
    pointer?.file !== TEMP_EXPORT_PROOF_FILE ||
    basename(resolve(artifactPath)) !== TEMP_EXPORT_PROOF_FILE ||
    !SHA256.test(pointer?.sha256 ?? "") ||
    pointer?.querySha256 !== TEMP_EXPORT_QUERY_SHA256
  )
    fail("receipt_invalid");

  const artifact = readJson(artifactPath);
  const proof = artifact.data;
  if (
    artifact.sha256 !== pointer.sha256 ||
    proof?.schemaVersion !== 1 ||
    proof?.proofId !== TEMP_EXPORT_PROOF_ID ||
    proof?.sourceCommit !== receipt.sourceCommit ||
    !SHA40.test(proof?.sourceTree ?? "") ||
    proof?.querySha256 !== TEMP_EXPORT_QUERY_SHA256 ||
    proof?.isolatedFingerprintMatch !== true ||
    proof?.liveCatalogCompared !== false ||
    proof?.schemaProofPromoted !== false ||
    proof?.canonicalHistoryReconciled !== false ||
    proof?.productionReleaseReady !== false ||
    proof?.productionRowsRestored !== false ||
    proof?.baseline?.capture?.ledgerVersionCount !== receipt.baselineVersions
  )
    fail("artifact_invalid");

  const before = temporaryExportSnapshot(
    proof.baseline.capture,
    proof.baseline.capture.ledgerVersions,
  );
  const after = temporaryExportSnapshot(
    proof.upgraded.capture,
    proof.upgraded.capture.ledgerVersions,
  );
  const replayVersions = receipt.replayPendingVersions;
  const expectedFinalVersions = Array.isArray(replayVersions)
    ? [...new Set([...before.capture.ledgerVersions, ...replayVersions])].sort()
    : [];
  if (
    JSON.stringify(before.fingerprint) !== JSON.stringify(proof.baseline.fingerprint) ||
    JSON.stringify(after.fingerprint) !== JSON.stringify(proof.upgraded.fingerprint) ||
    JSON.stringify(before.fingerprint) !== JSON.stringify(after.fingerprint) ||
    !Array.isArray(replayVersions) ||
    replayVersions.length === 0 ||
    expectedFinalVersions.length !== before.capture.ledgerVersionCount + replayVersions.length ||
    JSON.stringify(expectedFinalVersions) !== JSON.stringify(after.capture.ledgerVersions)
  )
    fail("artifact_fingerprint_mismatch");

  const live = readJson(livePath);
  const observed = temporaryExportSnapshot(live.data, before.capture.ledgerVersions);
  if (
    Date.parse(observed.capture.capturedAt) < Date.parse(after.capture.capturedAt) ||
    JSON.stringify(observed.capture.ledgerVersions) !==
      JSON.stringify(before.capture.ledgerVersions)
  )
    fail("live_checkpoint_mismatch");

  const scopedCatalogMatch =
    JSON.stringify(observed.fingerprint) === JSON.stringify(before.fingerprint) &&
    JSON.stringify(observed.fingerprint) === JSON.stringify(after.fingerprint);
  return {
    schemaVersion: 1,
    artifactKind: "temporary-export-live-catalog-comparison",
    proofId: TEMP_EXPORT_PROOF_ID,
    sourceCommit: proof.sourceCommit,
    sourceTree: proof.sourceTree,
    querySha256: TEMP_EXPORT_QUERY_SHA256,
    artifactSha256: artifact.sha256,
    liveCaptureSha256: live.sha256,
    capturedAt: observed.capture.capturedAt,
    liveLedgerVersionCount: observed.capture.ledgerVersionCount,
    isolatedFingerprint: before.fingerprint,
    liveFingerprint: observed.fingerprint,
    scopedCatalogMatch,
    liveCatalogCompared: true,
    schemaProofPromoted: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) fail("usage");
  console.log(
    JSON.stringify(
      compareLiveTemporaryExportCatalog({
        receiptPath: args[0],
        artifactPath: args[1],
        livePath: args[2],
      }),
      null,
      2,
    ),
  );
}
