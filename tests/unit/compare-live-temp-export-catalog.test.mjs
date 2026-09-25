import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compareLiveTemporaryExportCatalog } from "../../scripts/release/compare-live-temp-export-catalog.mjs";
import {
  TEMP_EXPORT_PROOF_FILE,
  TEMP_EXPORT_QUERY_SHA256,
  buildTemporaryExportProof,
} from "../../scripts/release/upgrade-database-temp-export-proof.mjs";

const baseVersions = ["20260824085042"];
const nextVersion = "20260907120000";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function capture(versions, capturedAt) {
  return {
    schemaVersion: 1,
    captureKind: "temporary-export-catalog-absence",
    capturedAt,
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    exactSignaturePresent: false,
    routineFamilyCount: 0,
    inboundDependencyCount: 0,
    storedReferenceCount: 0,
    ledgerVersionCount: versions.length,
    ledgerVersions: versions,
  };
}

test("live temporary-export comparison rejects reversed receipt-bound checkpoints", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-temp-compare-"));
  try {
    const sourceCommit = "a".repeat(40);
    const artifactPath = join(root, TEMP_EXPORT_PROOF_FILE);
    const receiptPath = join(root, "upgrade-database.json");
    const livePath = join(root, "live-temp-export.json");
    const proof = buildTemporaryExportProof({
      baseline: capture(baseVersions, "2026-09-23T10:00:00.000Z"),
      upgraded: capture([...baseVersions, nextVersion], "2026-09-23T10:01:00.000Z"),
      baselineVersions: baseVersions,
      finalVersions: [...baseVersions, nextVersion],
      sourceCommit,
      sourceTree: "b".repeat(40),
    });
    const receipt = {
      passed: true,
      executed: true,
      sourceCommit,
      baselineVersions: baseVersions.length,
      replayPendingVersions: [nextVersion],
      currentHistory: {
        requiresCanonicalHistoryReconciliation: true,
        productionReleaseReady: false,
      },
      temporaryExportProof: {
        file: TEMP_EXPORT_PROOF_FILE,
        querySha256: TEMP_EXPORT_QUERY_SHA256,
        sha256: "",
      },
    };
    const write = () => {
      const bytes = JSON.stringify(proof);
      receipt.temporaryExportProof.sha256 = hash(bytes);
      writeFileSync(artifactPath, bytes);
      writeFileSync(receiptPath, JSON.stringify(receipt));
    };
    writeFileSync(livePath, JSON.stringify(capture(baseVersions, "2026-09-23T10:02:00.000Z")));
    write();
    const valid = compareLiveTemporaryExportCatalog({ receiptPath, artifactPath, livePath });
    assert.equal(valid.scopedCatalogMatch, true);
    assert.equal(valid.liveQueryIdentityVerified, false);
    assert.equal(Object.hasOwn(valid, "querySha256"), false);
    proof.upgraded.capture.capturedAt = "2026-09-23T09:59:00.000Z";
    write();
    assert.throws(
      () => compareLiveTemporaryExportCatalog({ receiptPath, artifactPath, livePath }),
      /temp_export_live_comparison_artifact_fingerprint_mismatch/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
