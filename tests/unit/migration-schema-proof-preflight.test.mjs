import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  digestMigrationSchemaScope,
  digestMigrationSchemaSnapshot,
  fingerprintMigrationSchemaSnapshot,
} from "../../scripts/release/migration-schema-fingerprint.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value)}\n`);
const script = new URL("../../scripts/release/migration-preflight.mjs", import.meta.url);

test("ready preflight requires and verifies both provenance-bound schema artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-proof-ready-"));
  try {
    const sourceVersion = "20260101000000";
    const remoteVersion = "20260102000000";
    mkdirSync(join(directory, "supabase", "migrations"), { recursive: true });
    writeFileSync(
      join(directory, "supabase", "migrations", `${sourceVersion}_source.sql`),
      "select 1;\n",
    );
    const git = (args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    git(["init"]);
    git(["config", "user.name", "Kova Test"]);
    git(["config", "user.email", "test@kovagpt.invalid"]);
    git(["add", "supabase/migrations"]);
    git(["commit", "-m", "source checkpoint"]);
    const sourceCommit = git(["rev-parse", "HEAD"]);
    const sourceTree = git(["rev-parse", "HEAD^{tree}"]);
    const targetProjectRef = "abcdefghijklmnopqrst";
    const proofId = `proof-${remoteVersion}`;
    const sourceLedgerVersions = [sourceVersion];
    const remoteLedgerVersions = [sourceVersion, remoteVersion];
    const sourceLedgerVersionsSha256 = sha256(sourceLedgerVersions.join("\n"));
    const remoteLedgerVersionsSha256 = sha256(remoteLedgerVersions.join("\n"));
    const capturedAt = "2026-01-02T01:00:00.000Z";
    const artifactCreatedAt = "2026-01-02T02:00:00.000Z";
    const querySha256 = "3".repeat(64);
    const snapshot = {
      schemaVersion: 1,
      scope: { proofId, objects: ["public.reconciled_table"] },
      categories: {
        schema: [{ table: "public.reconciled_table", columnsSha256: "4".repeat(64) }],
        acl: [{ table: "public.reconciled_table", grantee: "authenticated" }],
        rls: [{ table: "public.reconciled_table", enabled: true }],
        function: [{ applicable: false }],
      },
    };
    const fingerprint = fingerprintMigrationSchemaSnapshot(snapshot);
    const captureSha256 = digestMigrationSchemaSnapshot(snapshot);
    const scopeSha256 = digestMigrationSchemaScope(snapshot);
    const capture = (ledgerVersionsSha256) => ({
      proofId,
      remoteVersion,
      capturedAt,
      querySha256,
      ledgerVersionsSha256,
      snapshot,
    });
    const sourceArtifact = Buffer.from(
      `${JSON.stringify({
        schemaVersion: 1,
        artifactKind: "migration-schema-source-captures",
        createdAt: artifactCreatedAt,
        sourceCommit,
        sourceTree,
        ledgerVersionsSha256: sourceLedgerVersionsSha256,
        ledgerVersions: sourceLedgerVersions,
        captures: [capture(sourceLedgerVersionsSha256)],
      })}\n`,
    );
    const remoteArtifact = Buffer.from(
      `${JSON.stringify({
        schemaVersion: 1,
        artifactKind: "migration-schema-remote-captures",
        createdAt: artifactCreatedAt,
        targetProjectRef,
        ledgerVersionsSha256: remoteLedgerVersionsSha256,
        ledgerVersions: remoteLedgerVersions,
        captures: [capture(remoteLedgerVersionsSha256)],
      })}\n`,
    );

    const paths = Object.fromEntries(
      [
        "manifest",
        "lineage",
        "remote",
        "proof",
        "sourceArtifact",
        "remoteArtifact",
        "otherEvidence",
      ].map((name) => [name, join(directory, `${name}.json`)]),
    );
    writeJson(paths.manifest, {
      count: 1,
      latest: `${sourceVersion}_source.sql`,
      migrations: [
        {
          order: 1,
          timestamp: sourceVersion,
          filename: `${sourceVersion}_source.sql`,
          sha256: "5".repeat(64),
          destructive: false,
          dataBackfill: false,
          rls: [],
          functions: [],
        },
      ],
    });
    writeJson(paths.lineage, {
      schemaVersion: 1,
      observedSourceCommit: sourceCommit,
      targetProjectRef,
      observedRemoteMigrationCount: 2,
      observedSourceMigrationCount: 1,
      entries: [
        {
          remoteVersion,
          remoteName: "reconciled",
          status: "schema_proven",
          sourceVersions: [sourceVersion],
          comparison: "schema-acl-rls-function-fingerprint",
          proofId,
          querySha256,
          scopeSha256,
        },
      ],
    });
    writeJson(paths.remote, {
      targetProjectRef,
      migrationCount: 2,
      migrations: remoteLedgerVersions,
    });
    writeFileSync(paths.sourceArtifact, sourceArtifact);
    writeFileSync(paths.remoteArtifact, remoteArtifact);
    writeJson(paths.proof, {
      schemaVersion: 2,
      targetProjectRef,
      observedSourceMigrationCount: 1,
      observedRemoteMigrationCount: 2,
      sourceProvenance: {
        sourceCommit,
        sourceTree,
        artifactSha256: sha256(sourceArtifact),
        artifactCreatedAt,
        ledgerVersionsSha256: sourceLedgerVersionsSha256,
      },
      remoteProvenance: {
        artifactSha256: sha256(remoteArtifact),
        artifactCreatedAt,
        ledgerVersionsSha256: remoteLedgerVersionsSha256,
      },
      proofs: [
        {
          proofId,
          remoteVersion,
          sourceVersions: [sourceVersion],
          scopeSha256,
          sourceCapture: {
            capturedAt,
            querySha256,
            captureSha256,
            ledgerVersionsSha256: sourceLedgerVersionsSha256,
            fingerprint,
          },
          remoteCapture: {
            capturedAt,
            querySha256,
            captureSha256,
            ledgerVersionsSha256: remoteLedgerVersionsSha256,
            fingerprint,
          },
        },
      ],
    });
    writeJson(paths.otherEvidence, { present: true });

    const environment = {
      ...process.env,
      SUPABASE_PROJECT_REF: targetProjectRef,
      KOVA_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      KOVA_MIGRATION_MANIFEST: paths.manifest,
      KOVA_REMOTE_MIGRATION_FILE: paths.remote,
      KOVA_MIGRATION_LINEAGE_FILE: paths.lineage,
      KOVA_MIGRATION_SCHEMA_PROOF_FILE: paths.proof,
      KOVA_MIGRATION_SCHEMA_SOURCE_ARTIFACT: paths.sourceArtifact,
      KOVA_MIGRATION_SCHEMA_REMOTE_ARTIFACT: paths.remoteArtifact,
      KOVA_FRESH_DATABASE_EVIDENCE: paths.otherEvidence,
      KOVA_UPGRADE_REHEARSAL_EVIDENCE: paths.otherEvidence,
      KOVA_RLS_TWO_USER_EVIDENCE: paths.otherEvidence,
      KOVA_BACKUP_EVIDENCE: paths.otherEvidence,
    };
    const stdout = execFileSync(process.execPath, [script.pathname, "--ready"], {
      cwd: directory,
      encoding: "utf8",
      env: environment,
    });
    const report = JSON.parse(
      stdout
        .split("\n")
        .find((line) => line.startsWith("MIGRATION_PREFLIGHT="))
        .slice("MIGRATION_PREFLIGHT=".length),
    );
    assert.equal(report.ready, true);
    assert.equal(report.schemaProof.proofCount, 1);
    assert.equal(report.schemaProof.sourceArtifactSha256, sha256(sourceArtifact));
    assert.equal(report.schemaProof.remoteArtifactSha256, sha256(remoteArtifact));

    const missingArtifactEnvironment = { ...environment };
    delete missingArtifactEnvironment.KOVA_MIGRATION_SCHEMA_REMOTE_ARTIFACT;
    const missing = spawnSync(process.execPath, [script.pathname, "--ready"], {
      cwd: directory,
      encoding: "utf8",
      env: missingArtifactEnvironment,
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing_release_evidence:KOVA_MIGRATION_SCHEMA_REMOTE_ARTIFACT/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
