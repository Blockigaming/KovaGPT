import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION = /^\d{14}$/u;
const FILENAME = /^(\d{14})_[A-Za-z0-9_.-]+\.sql$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const LINEAGE_STATUS = new Set(["equivalent", "requires_schema_proof"]);
const EQUIVALENCE_COMPARISON = new Set(["exact-content", "terminal-newline-only"]);

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
  if (!Array.isArray(lineage.entries) || !lineage.entries.length)
    throw new Error("migration_lineage_entries_missing");

  const sourceByVersion = new Map(
    (manifest?.migrations ?? []).map((migration) => [migration.timestamp, migration]),
  );
  const remoteVersions = new Set();
  let equivalent = 0;
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
    remoteVersions: [...remoteVersions].sort(),
    equivalent,
    requiresSchemaProof,
  };
}

export function classifyRemoteMigrationLineage(remoteVersions, lineage) {
  const byRemoteVersion = new Map(lineage.entries.map((entry) => [entry.remoteVersion, entry]));
  const unknownRemote = [];
  const equivalent = [];
  const requiresSchemaProof = [];

  for (const version of remoteVersions) {
    const entry = byRemoteVersion.get(version);
    if (!entry) {
      unknownRemote.push(version);
    } else if (entry.status === "equivalent") {
      equivalent.push({ remoteVersion: version, sourceVersion: entry.sourceVersion });
    } else {
      requiresSchemaProof.push(version);
    }
  }

  return { unknownRemote, equivalent, requiresSchemaProof };
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
    const remote = normalizeRemoteVersions(JSON.parse(readFileSync(remotePath, "utf8")));
    const reconciliation = reconcileMigrationVersions(analysis.versions, remote);
    const lineagePath = requiredEvidence("KOVA_MIGRATION_LINEAGE_FILE");
    const lineage = JSON.parse(readFileSync(lineagePath, "utf8"));
    const lineageAnalysis = validateMigrationLineage(lineage, manifest);
    if (lineageAnalysis.targetProjectRef !== targetRef)
      throw new Error("migration_lineage_target_mismatch");
    const remoteLineage = classifyRemoteMigrationLineage(reconciliation.unknownRemote, lineage);
    if (remoteLineage.unknownRemote.length) throw new Error("remote_migration_history_unknown");
    if (remoteLineage.requiresSchemaProof.length)
      throw new Error("remote_migration_lineage_unverified");
    requiredEvidence("KOVA_FRESH_DATABASE_EVIDENCE");
    requiredEvidence("KOVA_UPGRADE_REHEARSAL_EVIDENCE");
    requiredEvidence("KOVA_RLS_TWO_USER_EVIDENCE");
    requiredEvidence("KOVA_BACKUP_EVIDENCE");
    Object.assign(report, {
      targetRef,
      remoteCount: remote.length,
      reconciliation,
      remoteLineage,
    });
  }

  for (const group of analysis.duplicateContent) {
    console.warn(`MIGRATION_DUPLICATE_CONTENT=${group.join(",")}`);
  }
  console.log(`MIGRATION_PREFLIGHT=${JSON.stringify(report)}`);
}
