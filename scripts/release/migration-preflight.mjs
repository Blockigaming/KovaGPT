import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION = /^\d{14}$/u;
const FILENAME = /^(\d{14})_[A-Za-z0-9_.-]+\.sql$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const LINEAGE_STATUS = new Set(["equivalent", "schema_proven", "requires_schema_proof"]);
const EQUIVALENCE_COMPARISON = new Set(["exact-content", "terminal-newline-only"]);
const SCHEMA_PROOF_COMPARISON = "schema-acl-rls-function-fingerprint";
const FINGERPRINT_FIELDS = ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"];

function equalStringSets(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validFingerprint(value) {
  return (
    value &&
    typeof value === "object" &&
    FINGERPRINT_FIELDS.every((field) => SHA256.test(value[field] ?? ""))
  );
}

function equalFingerprint(left, right) {
  return (
    validFingerprint(left) &&
    validFingerprint(right) &&
    FINGERPRINT_FIELDS.every((field) => left[field] === right[field])
  );
}

export function analyzeMigrationManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("migration_manifest_invalid");
  const migrations = Array.isArray(manifest.migrations) ? manifest.migrations : [];
  if (manifest.count !== migrations.length) throw new Error("migration_manifest_count_mismatch");
  if (!migrations.length) throw new Error("migration_manifest_empty");

  const versions = [];
  const hashes = new Map();
  let previous = "";
  let destructive = 0;
  let dataBackfill = 0;
  let rlsChanges = 0;
  let functionChanges = 0;

  for (const [index, migration] of migrations.entries()) {
    if (migration.order !== index + 1)
      throw new Error(`migration_order_invalid:${migration.filename}`);
    const match = FILENAME.exec(migration.filename ?? "");
    if (!match) throw new Error(`migration_filename_invalid:${migration.filename}`);
    const version = match[1];
    if (version < previous) throw new Error(`migration_order_not_monotonic:${migration.filename}`);
    previous = version;
    versions.push(version);
    if (!SHA256.test(migration.sha256 ?? ""))
      throw new Error(`migration_sha_invalid:${migration.filename}`);
    const group = hashes.get(migration.sha256) ?? [];
    group.push(migration.filename);
    hashes.set(migration.sha256, group);
    if (migration.destructive) destructive += 1;
    if (migration.dataBackfill) dataBackfill += 1;
    if (Array.isArray(migration.rls) && migration.rls.length) rlsChanges += 1;
    if (Array.isArray(migration.functions) && migration.functions.length) functionChanges += 1;
  }

  if (manifest.latest !== migrations.at(-1).filename)
    throw new Error("migration_manifest_latest_mismatch");
  const duplicateContent = [...hashes.values()].filter((group) => group.length > 1);
  return {
    count: migrations.length,
    first: migrations[0].filename,
    latest: migrations.at(-1).filename,
    versions,
    duplicateContent,
    destructive,
    dataBackfill,
    rlsChanges,
    functionChanges,
  };
}

export function normalizeRemoteVersions(value) {
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(value?.migrations)
      ? value.migrations
      : Array.isArray(value?.versions)
        ? value.versions
        : [];
  return [
    ...new Set(
      candidates
        .map((item) => {
          const raw =
            typeof item === "string"
              ? item
              : String(item?.version ?? item?.timestamp ?? item?.name ?? "");
          const match = raw.match(/\d{14}/u);
          return match?.[0] ?? "";
        })
        .filter((version) => VERSION.test(version)),
    ),
  ].sort();
}

export function reconcileMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);
  return {
    pending: localVersions.filter((version) => !remote.has(version)),
    unknownRemote: remoteVersions.filter((version) => !local.has(version)),
    applied: localVersions.filter((version) => remote.has(version)),
  };
}

export function validateMigrationLineage(lineage, manifest) {
  if (!lineage || typeof lineage !== "object") throw new Error("migration_lineage_invalid");
  if (lineage.schemaVersion !== 1) throw new Error("migration_lineage_schema_invalid");
  if (!/^[a-z0-9]{20}$/u.test(lineage.targetProjectRef ?? ""))
    throw new Error("migration_lineage_target_invalid");
  if (!Array.isArray(lineage.entries)) throw new Error("migration_lineage_entries_invalid");

  const sourceByVersion = new Map(
    (manifest?.migrations ?? []).map((migration) => [migration.timestamp, migration]),
  );
  if (
    !Number.isSafeInteger(lineage.observedSourceMigrationCount) ||
    lineage.observedSourceMigrationCount !== sourceByVersion.size
  ) {
    throw new Error("migration_lineage_source_count_mismatch");
  }
  if (
    !Number.isSafeInteger(lineage.observedRemoteMigrationCount) ||
    lineage.observedRemoteMigrationCount < lineage.entries.length
  ) {
    throw new Error("migration_lineage_remote_count_invalid");
  }
  const remoteVersions = new Set();
  const proofIds = new Set();
  let equivalent = 0;
  let schemaProven = 0;
  let requiresSchemaProof = 0;

  for (const entry of lineage.entries) {
    if (!VERSION.test(entry?.remoteVersion ?? ""))
      throw new Error("migration_lineage_remote_version_invalid");
    if (remoteVersions.has(entry.remoteVersion))
      throw new Error("migration_lineage_remote_duplicate");
    remoteVersions.add(entry.remoteVersion);
    if (typeof entry.remoteName !== "string" || !entry.remoteName.trim())
      throw new Error("migration_lineage_remote_name_invalid");
    if (!LINEAGE_STATUS.has(entry.status)) throw new Error("migration_lineage_status_invalid");

    if (entry.status === "equivalent") {
      const source = sourceByVersion.get(entry.sourceVersion);
      if (
        !source ||
        source.filename !== entry.sourceFilename ||
        source.sha256 !== entry.sourceSha256
      )
        throw new Error("migration_lineage_equivalent_source_invalid");
      if (!EQUIVALENCE_COMPARISON.has(entry.comparison))
        throw new Error("migration_lineage_equivalence_comparison_invalid");
      equivalent += 1;
      continue;
    }

    if (entry.status === "schema_proven") {
      const sourceVersions = Array.isArray(entry.sourceVersions)
        ? [...new Set(entry.sourceVersions)].sort()
        : [];
      if (
        !sourceVersions.length ||
        sourceVersions.some((version) => !VERSION.test(version) || !sourceByVersion.has(version)) ||
        entry.comparison !== SCHEMA_PROOF_COMPARISON ||
        typeof entry.proofId !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{2,127}$/u.test(entry.proofId) ||
        proofIds.has(entry.proofId)
      ) {
        throw new Error("migration_lineage_schema_proven_invalid");
      }
      proofIds.add(entry.proofId);
      schemaProven += 1;
      continue;
    }

    if (
      !Array.isArray(entry.candidateSourceVersions) ||
      !entry.candidateSourceVersions.length ||
      entry.candidateSourceVersions.some((version) => !sourceByVersion.has(version)) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    ) {
      throw new Error("migration_lineage_schema_proof_invalid");
    }
    requiresSchemaProof += 1;
  }

  return {
    targetProjectRef: lineage.targetProjectRef,
    observedRemoteMigrationCount: lineage.observedRemoteMigrationCount,
    observedSourceMigrationCount: lineage.observedSourceMigrationCount,
    remoteVersions: [...remoteVersions].sort(),
    equivalent,
    schemaProven,
    requiresSchemaProof,
  };
}

export function classifyRemoteMigrationLineage(remoteVersions, lineage) {
  const byRemoteVersion = new Map(lineage.entries.map((entry) => [entry.remoteVersion, entry]));
  const unknownRemote = [];
  const equivalent = [];
  const schemaProven = [];
  const requiresSchemaProof = [];

  for (const version of remoteVersions) {
    const entry = byRemoteVersion.get(version);
    if (!entry) {
      unknownRemote.push(version);
    } else if (entry.status === "equivalent") {
      equivalent.push({ remoteVersion: version, sourceVersion: entry.sourceVersion });
    } else if (entry.status === "schema_proven") {
      schemaProven.push({
        remoteVersion: version,
        sourceVersions: [...new Set(entry.sourceVersions)].sort(),
        proofId: entry.proofId,
      });
    } else {
      requiresSchemaProof.push(version);
    }
  }

  return { unknownRemote, equivalent, schemaProven, requiresSchemaProof };
}

export function validateRemoteMigrationEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("remote_migration_evidence_invalid");
  if (!/^[a-z0-9]{20}$/u.test(value.targetProjectRef ?? ""))
    throw new Error("remote_migration_evidence_target_invalid");
  const migrations = Array.isArray(value.migrations)
    ? value.migrations
    : Array.isArray(value.versions)
      ? value.versions
      : null;
  if (!migrations) throw new Error("remote_migration_evidence_versions_missing");
  if (
    !Number.isSafeInteger(value.migrationCount) ||
    value.migrationCount < 0 ||
    value.migrationCount !== migrations.length
  ) {
    throw new Error("remote_migration_evidence_count_invalid");
  }
  const versions = normalizeRemoteVersions({ migrations });
  if (versions.length !== migrations.length)
    throw new Error("remote_migration_evidence_versions_invalid");
  return {
    targetProjectRef: value.targetProjectRef,
    migrationCount: value.migrationCount,
    versions,
  };
}

export function assertRemoteLineageInventory(lineageAnalysis, remoteEvidence, reconciliation) {
  if (remoteEvidence.targetProjectRef !== lineageAnalysis.targetProjectRef)
    throw new Error("migration_lineage_target_mismatch");
  if (remoteEvidence.migrationCount !== lineageAnalysis.observedRemoteMigrationCount)
    throw new Error("migration_lineage_remote_count_mismatch");
  const inventoried = lineageAnalysis.remoteVersions;
  const observed = reconciliation.unknownRemote;
  if (!equalStringSets(inventoried, observed))
    throw new Error("migration_lineage_remote_inventory_mismatch");
}

export function assertLineageSourceVersionsRepaired(remoteLineage, remoteVersions) {
  const remote = new Set(remoteVersions);
  const repairedSources = [
    ...remoteLineage.equivalent.map((entry) => entry.sourceVersion),
    ...remoteLineage.schemaProven.flatMap((entry) => entry.sourceVersions),
  ];
  if (repairedSources.some((version) => !remote.has(version)))
    throw new Error("remote_migration_source_history_unrepaired");
}

export function validateSchemaProofEvidence(value, lineage, remoteEvidence) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("migration_schema_proof_invalid");
  if (value.schemaVersion !== 1) throw new Error("migration_schema_proof_schema_invalid");
  if (value.targetProjectRef !== remoteEvidence.targetProjectRef)
    throw new Error("migration_schema_proof_target_mismatch");
  if (value.observedRemoteMigrationCount !== remoteEvidence.migrationCount)
    throw new Error("migration_schema_proof_remote_count_mismatch");
  if (!Array.isArray(value.proofs)) throw new Error("migration_schema_proof_entries_invalid");

  const required = lineage.entries.filter((entry) => entry.status === "schema_proven");
  if (value.proofs.length !== required.length)
    throw new Error("migration_schema_proof_entry_count_mismatch");
  const proofs = new Map();
  for (const proof of value.proofs) {
    if (
      !proof ||
      typeof proof !== "object" ||
      typeof proof.proofId !== "string" ||
      proofs.has(proof.proofId) ||
      !VERSION.test(proof.remoteVersion ?? "") ||
      !Array.isArray(proof.sourceVersions) ||
      proof.sourceVersions.some((version) => !VERSION.test(version)) ||
      new Set(proof.sourceVersions).size !== proof.sourceVersions.length ||
      !equalFingerprint(proof.sourceFingerprint, proof.remoteFingerprint)
    ) {
      throw new Error("migration_schema_proof_entry_invalid");
    }
    proofs.set(proof.proofId, proof);
  }

  for (const entry of required) {
    const proof = proofs.get(entry.proofId);
    const expectedSources = [...new Set(entry.sourceVersions)].sort();
    const proofSources = Array.isArray(proof?.sourceVersions)
      ? [...new Set(proof.sourceVersions)].sort()
      : [];
    if (
      !proof ||
      proof.remoteVersion !== entry.remoteVersion ||
      !equalStringSets(proofSources, expectedSources)
    ) {
      throw new Error("migration_schema_proof_entry_mismatch");
    }
  }
  return { proofCount: required.length };
}

function requiredEvidence(name) {
  const path = process.env[name];
  if (!path || !existsSync(resolve(path))) throw new Error(`missing_release_evidence:${name}`);
  return resolve(path);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sourceOnly = process.argv.includes("--source-only") || !process.argv.includes("--ready");
  const ready = process.argv.includes("--ready");
  const manifestPath = resolve(process.env.KOVA_MIGRATION_MANIFEST ?? "release-migrations.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const analysis = analyzeMigrationManifest(manifest);
  const report = { sourceOnly, ready, ...analysis };

  if (ready) {
    const targetRef = process.env.SUPABASE_PROJECT_REF ?? "";
    if (!/^[a-z0-9]{20}$/u.test(targetRef)) throw new Error("SUPABASE_PROJECT_REF_required");
    const productionRef = process.env.KOVA_PRODUCTION_SUPABASE_PROJECT_REF ?? "";
    if (
      targetRef === productionRef &&
      process.env.KOVA_PRODUCTION_MIGRATION_APPROVED !== targetRef
    ) {
      throw new Error("production_migration_not_explicitly_approved");
    }
    const remotePath = requiredEvidence("KOVA_REMOTE_MIGRATION_FILE");
    const remoteEvidence = validateRemoteMigrationEvidence(
      JSON.parse(readFileSync(remotePath, "utf8")),
    );
    if (remoteEvidence.targetProjectRef !== targetRef)
      throw new Error("remote_migration_evidence_target_mismatch");
    const reconciliation = reconcileMigrationVersions(analysis.versions, remoteEvidence.versions);
    const lineagePath = requiredEvidence("KOVA_MIGRATION_LINEAGE_FILE");
    const lineage = JSON.parse(readFileSync(lineagePath, "utf8"));
    const lineageAnalysis = validateMigrationLineage(lineage, manifest);
    if (lineageAnalysis.targetProjectRef !== targetRef)
      throw new Error("migration_lineage_target_mismatch");
    assertRemoteLineageInventory(lineageAnalysis, remoteEvidence, reconciliation);
    const remoteLineage = classifyRemoteMigrationLineage(reconciliation.unknownRemote, lineage);
    if (remoteLineage.unknownRemote.length) throw new Error("remote_migration_history_unknown");
    if (remoteLineage.requiresSchemaProof.length)
      throw new Error("remote_migration_lineage_unverified");
    assertLineageSourceVersionsRepaired(remoteLineage, remoteEvidence.versions);
    let schemaProof;
    if (lineageAnalysis.schemaProven) {
      const schemaProofPath = requiredEvidence("KOVA_MIGRATION_SCHEMA_PROOF_FILE");
      schemaProof = validateSchemaProofEvidence(
        JSON.parse(readFileSync(schemaProofPath, "utf8")),
        lineage,
        remoteEvidence,
      );
    }
    requiredEvidence("KOVA_FRESH_DATABASE_EVIDENCE");
    requiredEvidence("KOVA_UPGRADE_REHEARSAL_EVIDENCE");
    requiredEvidence("KOVA_RLS_TWO_USER_EVIDENCE");
    requiredEvidence("KOVA_BACKUP_EVIDENCE");
    Object.assign(report, {
      targetRef,
      remoteCount: remoteEvidence.migrationCount,
      reconciliation,
      remoteLineage,
      schemaProof,
    });
  }

  for (const group of analysis.duplicateContent) {
    console.warn(`MIGRATION_DUPLICATE_CONTENT=${group.join(",")}`);
  }
  console.log(`MIGRATION_PREFLIGHT=${JSON.stringify(report)}`);
}
