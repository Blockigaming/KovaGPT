import assert from "node:assert/strict";
import test from "node:test";

import { buildMigrationSchemaProofPlan } from "../../scripts/release/migration-schema-proof-plan.mjs";

const manifest = {
  count: 2,
  latest: "20260101000001_b.sql",
  migrations: [
    {
      order: 1,
      timestamp: "20260101000000",
      filename: "20260101000000_a.sql",
      sha256: "a".repeat(64),
    },
    {
      order: 2,
      timestamp: "20260101000001",
      filename: "20260101000001_b.sql",
      sha256: "b".repeat(64),
    },
  ],
};

const proofPlanOptions = {
  inspectSource: (sourceCommit) => ({
    sourceCommit,
    sourceTree: "2".repeat(40),
    ledgerVersions: manifest.migrations.map((migration) => migration.timestamp),
    ledgerVersionsSha256: "3".repeat(64),
    migrations: manifest.migrations.map(({ timestamp, filename, sha256 }) => ({
      version: timestamp,
      filename,
      sha256,
    })),
  }),
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

  assert.deepEqual(buildMigrationSchemaProofPlan(lineage, manifest, proofPlanOptions), {
    schemaVersion: 2,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedSourceMigrationCount: 2,
    currentSourceMigrationCount: 2,
    currentSourceDelta: { added: [], modified: [], removed: [] },
    requiresCurrentSourceReview: false,
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

test("schema proof plan exposes current additions and unrelated changes without promoting proofs", () => {
  const lineage = {
    schemaVersion: 1,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 1,
    observedSourceMigrationCount: 2,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "needs proof",
        status: "requires_schema_proof",
        candidateSourceVersions: ["20260101000000"],
        reason: "isolated scope comparison required",
      },
    ],
  };
  const expanded = {
    count: 3,
    latest: "20260101000002_c.sql",
    migrations: [
      manifest.migrations[0],
      { ...manifest.migrations[1], sha256: "c".repeat(64) },
      {
        order: 3,
        timestamp: "20260101000002",
        filename: "20260101000002_c.sql",
        sha256: "d".repeat(64),
      },
    ],
  };
  const plan = buildMigrationSchemaProofPlan(lineage, expanded, proofPlanOptions);
  assert.equal(plan.observedSourceMigrationCount, 2);
  assert.equal(plan.currentSourceMigrationCount, 3);
  assert.deepEqual(plan.currentSourceDelta, {
    added: ["20260101000002"],
    modified: ["20260101000001"],
    removed: [],
  });
  assert.equal(plan.requiresCurrentSourceReview, true);
  assert.equal(plan.requiredProofCount, 1);
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

  const plan = buildMigrationSchemaProofPlan(lineage, manifest, proofPlanOptions);
  assert.equal(plan.requiredProofCount, 0);
  assert.deepEqual(plan.sourceVersions, []);
  assert.deepEqual(plan.entries, []);
});

test("schema proof plan rejects absent or content-changed candidates at the pinned checkpoint", () => {
  const lineage = {
    schemaVersion: 1,
    observedSourceCommit: "1".repeat(40),
    targetProjectRef: "abcdefghijklmnopqrst",
    observedRemoteMigrationCount: 1,
    observedSourceMigrationCount: 2,
    entries: [
      {
        remoteVersion: "20260102000000",
        remoteName: "needs proof",
        status: "requires_schema_proof",
        candidateSourceVersions: ["20260101000001"],
        reason: "normalized database state must match",
      },
    ],
  };
  assert.throws(
    () =>
      buildMigrationSchemaProofPlan(lineage, manifest, {
        inspectSource: (sourceCommit) => ({
          ...proofPlanOptions.inspectSource(sourceCommit),
          migrations: proofPlanOptions
            .inspectSource(sourceCommit)
            .migrations.filter((migration) => migration.version !== "20260101000001"),
        }),
      }),
    /migration_lineage_source_checkpoint_(?:invalid|version_missing)/u,
  );
  assert.throws(
    () =>
      buildMigrationSchemaProofPlan(lineage, manifest, {
        inspectSource: (sourceCommit) => ({
          ...proofPlanOptions.inspectSource(sourceCommit),
          migrations: proofPlanOptions
            .inspectSource(sourceCommit)
            .migrations.map((migration) =>
              migration.version === "20260101000001"
                ? { ...migration, sha256: "c".repeat(64) }
                : migration,
            ),
        }),
      }),
    /migration_lineage_source_checkpoint_content_mismatch/u,
  );
});
