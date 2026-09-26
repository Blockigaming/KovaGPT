import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  analyzeMigrationManifest,
  inspectMigrationSourceCommit,
  validateLineageSourceCheckpoint,
  validateMigrationLineage,
} from "./migration-preflight.mjs";

const FINGERPRINT_FIELDS = ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"];
const CAPTURE_PROVENANCE_FIELDS = [
  "capturedAt",
  "querySha256",
  "captureSha256",
  "ledgerVersionsSha256",
];
const SOURCE_PROVENANCE_FIELDS = [
  "sourceCommit",
  "sourceTree",
  "artifactSha256",
  "artifactCreatedAt",
  "ledgerVersionsSha256",
];
const REMOTE_PROVENANCE_FIELDS = ["artifactSha256", "artifactCreatedAt", "ledgerVersionsSha256"];
const LINEAGE_PROMOTION_FIELDS = ["proofId", "querySha256", "scopeSha256"];

export function buildMigrationSchemaProofPlan(
  lineage,
  manifest,
  { repositoryPath = process.cwd(), inspectSource = inspectMigrationSourceCommit } = {},
) {
  const currentManifest = analyzeMigrationManifest(manifest);
  const analysis = validateMigrationLineage(lineage, manifest);
  const checkpoint = validateLineageSourceCheckpoint(lineage, manifest, {
    repositoryPath,
    inspectSource,
  });
  const currentByVersion = new Map(
    manifest.migrations.map((migration) => [migration.timestamp, migration]),
  );
  const observedByVersion = new Map(
    checkpoint.migrations.map((migration) => [migration.version, migration]),
  );
  const added = currentManifest.versions.filter((version) => !observedByVersion.has(version));
  const modified = currentManifest.versions.filter((version) => {
    const observed = observedByVersion.get(version);
    const current = currentByVersion.get(version);
    return (
      observed && (observed.filename !== current.filename || observed.sha256 !== current.sha256)
    );
  });
  const removed = checkpoint.ledgerVersions.filter((version) => !currentByVersion.has(version));
  const entries = lineage.entries
    .filter((entry) => entry.status === "requires_schema_proof")
    .map((entry) => ({
      proofId: `proof-${entry.remoteVersion}`,
      remoteVersion: entry.remoteVersion,
      remoteName: entry.remoteName,
      sourceVersions: [...new Set(entry.candidateSourceVersions)].sort(),
      requiredLineagePromotionFields: [...LINEAGE_PROMOTION_FIELDS],
      requiredCaptureProvenanceFields: [...CAPTURE_PROVENANCE_FIELDS],
      requiredFingerprintFields: [...FINGERPRINT_FIELDS],
      reason: entry.reason,
    }));

  const sourceVersions = [...new Set(entries.flatMap((entry) => entry.sourceVersions))].sort();

  return {
    schemaVersion: 2,
    observedSourceCommit: analysis.observedSourceCommit,
    targetProjectRef: analysis.targetProjectRef,
    observedSourceMigrationCount: analysis.observedSourceMigrationCount,
    currentSourceMigrationCount: currentManifest.count,
    currentSourceDelta: { added, modified, removed },
    requiresCurrentSourceReview: Boolean(added.length || modified.length || removed.length),
    observedRemoteMigrationCount: analysis.observedRemoteMigrationCount,
    requiredSourceProvenanceFields: [...SOURCE_PROVENANCE_FIELDS],
    requiredRemoteProvenanceFields: [...REMOTE_PROVENANCE_FIELDS],
    requiredProofCount: entries.length,
    sourceVersions,
    entries,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lineagePath = resolve(
    process.env.KOVA_MIGRATION_LINEAGE_FILE ?? "release-migration-lineage.json",
  );
  const manifestPath = resolve(process.env.KOVA_MIGRATION_MANIFEST ?? "release-migrations.json");
  const lineage = JSON.parse(readFileSync(lineagePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  process.stdout.write(
    `${JSON.stringify(buildMigrationSchemaProofPlan(lineage, manifest), null, 2)}\n`,
  );
}
