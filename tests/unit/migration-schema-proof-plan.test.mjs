import assert from "node:assert/strict";
import test from "node:test";

import { buildMigrationSchemaProofPlan } from "../../scripts/release/migration-schema-proof-plan.mjs";

const manifest = {
  migrations: [
    {
      timestamp: "20260101000000",
      filename: "20260101000000_a.sql",
      sha256: "a".repeat(64),
    },
    {
      timestamp: "20260101000001",
      filename: "20260101000001_b.sql",
      sha256: "b".repeat(64),
    },
  ],
};

test("schema proof plan includes only unresolved lineage entries and deduplicates source versions", () => {
  const lineage = {
    schemaVersion: 1,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 3,
    observedSourceMigrationCount: 2,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "equivalent",
        status: "equivalent",
        sourceVersion: "20260101000000",
        sourceFilename: "20260101000000_a.sql",
        sourceSha256: "a".repeat(64),
        comparison: "exact-content",
      },
      {
        remoteVersion: "20260102000001",
        remoteName: "needs proof",
        status: "requires_schema_proof",
        candidateSourceVersions: ["20260101000001", "20260101000000", "20260101000001"],
        reason: "normalized database state must match",
      },
    ],
  };

  assert.deepEqual(buildMigrationSchemaProofPlan(lineage, manifest), {
    schemaVersion: 2,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedSourceMigrationCount: 2,
    observedRemoteMigrationCount: 3,
    requiredSourceProvenanceFields: [
      "sourceCommit",
      "sourceTree",
      "artifactSha256",
      "artifactCreatedAt",
      "ledgerVersionsSha256",
    ],
    requiredRemoteProvenanceFields: ["artifactSha256", "artifactCreatedAt", "ledgerVersionsSha256"],
    requiredProofCount: 1,
    sourceVersions: ["20260101000000", "20260101000001"],
    entries: [
      {
        proofId: "proof-20260102000001",
        remoteVersion: "20260102000001",
        remoteName: "needs proof",
        sourceVersions: ["20260101000000", "20260101000001"],
        requiredLineagePromotionFields: ["proofId", "querySha256", "scopeSha256"],
        requiredCaptureProvenanceFields: [
          "capturedAt",
          "querySha256",
          "captureSha256",
          "ledgerVersionsSha256",
        ],
        requiredFingerprintFields: ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"],
        reason: "normalized database state must match",
      },
    ],
  });
});

test("schema proof plan is empty when every remote-only lineage entry is already proven", () => {
  const lineage = {
    schemaVersion: 1,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 2,
    observedSourceMigrationCount: 2,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "equivalent",
        status: "equivalent",
        sourceVersion: "20260101000000",
        sourceFilename: "20260101000000_a.sql",
        sourceSha256: "a".repeat(64),
        comparison: "exact-content",
      },
    ],
  };

  const plan = buildMigrationSchemaProofPlan(lineage, manifest);
  assert.equal(plan.requiredProofCount, 0);
  assert.deepEqual(plan.sourceVersions, []);
  assert.deepEqual(plan.entries, []);
});
