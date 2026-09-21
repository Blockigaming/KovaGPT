import assert from "node:assert/strict";
import test from "node:test";

import {
  TEMP_EXPORT_CANDIDATE_VERSION,
  TEMP_EXPORT_REMOTE_VERSION,
  buildTemporaryExportSourceProof,
  inspectTemporaryExportSource,
} from "../../scripts/release/migration-temp-export-source-proof.mjs";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const rows = [
  {
    order: 1,
    timestamp: "20260824090000",
    filename: "20260824090000_day15_chat_workspace_reconciliation.sql",
    sha256: "1".repeat(64),
  },
  {
    order: 2,
    timestamp: "20260901000000",
    filename: "20260901000000_later_writer.sql",
    sha256: "2".repeat(64),
  },
];
const lineage = {
  observedSourceCommit: commit,
  observedSourceMigrationCount: 2,
  entries: [
    {
      remoteVersion: TEMP_EXPORT_REMOTE_VERSION,
      status: "requires_schema_proof",
      candidateSourceVersions: [TEMP_EXPORT_CANDIDATE_VERSION],
    },
  ],
};
const manifest = { schemaVersion: 1, count: 2, migrations: rows };
const inspected = {
  sourceCommit: commit,
  sourceTree: tree,
  ledgerVersions: rows.map((row) => row.timestamp),
  ledgerVersionsSha256: "3".repeat(64),
  migrations: rows.map((row) => ({
    order: row.order,
    version: row.timestamp,
    filename: row.filename,
    sha256: row.sha256,
  })),
  matchingFiles: [],
};

test("temporary export source proof binds the complete pinned ledger without promotion", () => {
  const proof = buildTemporaryExportSourceProof(lineage, manifest, {
    inspectSource: () => structuredClone(inspected),
  });
  assert.equal(proof.artifactKind, "temporary-export-full-source-proof");
  assert.equal(proof.migrationCount, 2);
  assert.equal(proof.candidate.filename, rows[0].filename);
  assert.equal(proof.fullLedgerScanned, true);
  assert.deepEqual(proof.matchingFiles, []);
  assert.equal(proof.schemaProofPromoted, false);
  assert.equal(proof.canonicalHistoryReconciled, false);
  assert.equal(proof.productionReleaseReady, false);
});

test("temporary export source proof rejects any symbol occurrence", () => {
  assert.throws(
    () =>
      buildTemporaryExportSourceProof(lineage, manifest, {
        inspectSource: () => ({
          ...structuredClone(inspected),
          matchingFiles: [rows[1].filename],
        }),
      }),
    /temp_export_source_absence_unproven/u,
  );
});

test("temporary export source proof rejects ledger content or ordering drift", () => {
  for (const mutate of [
    (value) => (value.migrations[0].sha256 = "4".repeat(64)),
    (value) => value.migrations.reverse(),
    (value) => value.migrations.pop(),
  ]) {
    const changed = structuredClone(inspected);
    mutate(changed);
    assert.throws(
      () =>
        buildTemporaryExportSourceProof(lineage, manifest, {
          inspectSource: () => changed,
        }),
      /temp_export_source_(?:absence_unproven|manifest_mismatch)/u,
    );
  }
});

test("source inspector verifies every committed byte digest and scans case-insensitively", () => {
  const alpha = Buffer.from("select 1;\n");
  const beta = Buffer.from("select '_KOVA_TEMP_EXPORT_DAY15';\n");
  const checkpoint = {
    sourceCommit: commit,
    sourceTree: tree,
    ledgerVersions: rows.map((row) => row.timestamp),
    ledgerVersionsSha256: "3".repeat(64),
    migrations: rows.map((row, index) => ({
      version: row.timestamp,
      filename: row.filename,
      sha256:
        index === 0
          ? "4a45092ccf992ea92250053a80b931b787924ba61648f420555511b84f10ab6c"
          : "4790cbf906576392e2603220c07c59bb5573842271be80b4d21772ae48f0d36f",
    })),
  };
  const proof = inspectTemporaryExportSource(
    commit,
    ".",
    () => checkpoint,
    (_root, _commit, filename) =>
      filename === rows[0].filename ? alpha : beta,
  );
  assert.deepEqual(proof.matchingFiles, [rows[1].filename]);
});

test("source inspector rejects bytes that disagree with the pinned checkpoint", () => {
  const checkpoint = {
    ...structuredClone(inspected),
    migrations: inspected.migrations.map((migration) => ({
      ...migration,
      sha256: "0".repeat(64),
    })),
  };
  assert.throws(
    () =>
      inspectTemporaryExportSource(
        commit,
        ".",
        () => checkpoint,
        () => Buffer.from("select 1;\n"),
      ),
    /temp_export_source_content_mismatch/u,
  );
});
