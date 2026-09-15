import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateMigrationLineage } from "./migration-preflight.mjs";

const FINGERPRINT_FIELDS = ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"];

export function buildMigrationSchemaProofPlan(lineage, manifest) {
  const analysis = validateMigrationLineage(lineage, manifest);
  const entries = lineage.entries
    .filter((entry) => entry.status === "requires_schema_proof")
    .map((entry) => ({
      proofId: `proof-${entry.remoteVersion}`,
      remoteVersion: entry.remoteVersion,
      remoteName: entry.remoteName,
      sourceVersions: [...new Set(entry.candidateSourceVersions)].sort(),
      requiredFingerprintFields: [...FINGERPRINT_FIELDS],
      reason: entry.reason,
    }));

  const sourceVersions = [...new Set(entries.flatMap((entry) => entry.sourceVersions))].sort();

  return {
    schemaVersion: 1,
    targetProjectRef: analysis.targetProjectRef,
    observedRemoteMigrationCount: analysis.observedRemoteMigrationCount,
    requiredProofCount: entries.length,
    sourceVersions,
    entries,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lineagePath = resolve(process.env.KOVA_MIGRATION_LINEAGE_FILE ?? "release-migration-lineage.json");
  const manifestPath = resolve(process.env.KOVA_MIGRATION_MANIFEST ?? "release-migrations.json");
  const lineage = JSON.parse(readFileSync(lineagePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  process.stdout.write(`${JSON.stringify(buildMigrationSchemaProofPlan(lineage, manifest), null, 2)}\n`);
}
