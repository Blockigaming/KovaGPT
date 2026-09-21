import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  digestMigrationSchemaScope,
  digestMigrationSchemaSnapshot,
  fingerprintMigrationSchemaSnapshot,
} from "./migration-schema-fingerprint.mjs";

const VERSION = /^\d{14}$/u;
const FILENAME = /^(\d{14})_[A-Za-z0-9_.-]+\.sql$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const PROOF_ID = /^[a-z0-9][a-z0-9_-]{2,127}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_SCHEMA_PROOF_ARTIFACT_BYTES = 64 * 1024 * 1024;
const LINEAGE_STATUS = new Set(["equivalent", "schema_proven", "requires_schema_proof"]);
const EQUIVALENCE_COMPARISON = new Set(["exact-content", "terminal-newline-only"]);
const SCHEMA_PROOF_COMPARISON = "schema-acl-rls-function-fingerprint";
const FINGERPRINT_FIELDS = ["schemaSha256", "aclSha256", "rlsSha256", "functionSha256"];

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value, fields) {
  return (
    plainRecord(value) &&
    Reflect.ownKeys(value).length === fields.length &&
    fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return Boolean(descriptor?.enumerable && "value" in descriptor);
    })
  );
}

function validUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    UTC_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ledgerVersionsSha256(versions) {
  return sha256(versions.join("\n"));
}

function readSchemaProofArtifact(path, side) {
  let resolvedPath;
  let size;
  try {
    resolvedPath = resolve(path);
    const metadata = statSync(resolvedPath);
    if (!metadata.isFile()) throw new Error("not_a_file");
    size = metadata.size;
  } catch {
    throw new Error(`migration_schema_proof_${side}_artifact_unreadable`);
  }
  if (size > MAX_SCHEMA_PROOF_ARTIFACT_BYTES)
    throw new Error("migration_schema_proof_artifact_too_large");
  let bytes;
  try {
    bytes = readFileSync(resolvedPath);
  } catch {
    throw new Error(`migration_schema_proof_${side}_artifact_unreadable`);
  }
  if (bytes.length > MAX_SCHEMA_PROOF_ARTIFACT_BYTES)
    throw new Error("migration_schema_proof_artifact_too_large");
  return bytes;
}

function validOrderedVersions(versions, expectedCount) {
  return (
    Array.isArray(versions) &&
    versions.length === expectedCount &&
    versions.every((version) => typeof version === "string" && VERSION.test(version)) &&
    JSON.stringify(versions) === JSON.stringify([...new Set(versions)].sort())
  );
}

export function inspectMigrationSourceCommit(sourceCommit, repositoryPath = process.cwd()) {
  if (!GIT_SHA.test(sourceCommit ?? ""))
    throw new Error("migration_schema_proof_source_commit_invalid");

  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    });
    const git = (args) =>
      execFileSync(
        "git",
        [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.untrackedCache=false",
          "-C",
          resolve(repositoryPath),
          ...args,
        ],
        {
          env,
          encoding: "utf8",
          maxBuffer: MAX_SCHEMA_PROOF_ARTIFACT_BYTES,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    const resolvedCommit = git(["rev-parse", "--verify", `${sourceCommit}^{commit}`]).trim();
    if (resolvedCommit !== sourceCommit)
      throw new Error("migration_schema_proof_source_commit_mismatch");
    const sourceTree = git(["rev-parse", `${resolvedCommit}^{tree}`]).trim();
    if (!GIT_SHA.test(sourceTree)) throw new Error("migration_schema_proof_source_tree_invalid");

    const migrationPaths = git([
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      resolvedCommit,
      "--",
      "supabase/migrations",
    ])
      .split("\0")
      .filter(Boolean);
    const versions = migrationPaths.map((path) => {
      if (
        !path.startsWith("supabase/migrations/") ||
        path.slice("supabase/migrations/".length).includes("/")
      ) {
        throw new Error("migration_schema_proof_source_ledger_invalid");
      }
      const match = FILENAME.exec(basename(path));
      if (!match) throw new Error("migration_schema_proof_source_ledger_invalid");
      return match[1];
    });
    if (!validOrderedVersions(versions, versions.length))
      throw new Error("migration_schema_proof_source_ledger_invalid");
    const migrations = migrationPaths.map((path, index) => ({
      version: versions[index],
      filename: basename(path),
      sha256: sha256(git(["show", `${resolvedCommit}:${path}`])),
    }));
    return {
      sourceCommit: resolvedCommit,
      sourceTree,
      ledgerVersions: versions,
      ledgerVersionsSha256: ledgerVersionsSha256(versions),
      migrations,
    };
  } catch (error) {
    if (error?.message?.startsWith("migration_schema_proof_source_")) throw error;
    throw new Error("migration_schema_proof_source_commit_unavailable");
  }
}

export function validateLineageSourceCheckpoint(
  lineage,
  manifest,
  {
    repositoryPath = process.cwd(),
    inspectSource = inspectMigrationSourceCommit,
  } = {},
) {
  const checkpoint = inspectSource(lineage.observedSourceCommit, repositoryPath);
  if (
    checkpoint.sourceCommit !== lineage.observedSourceCommit ||
    checkpoint.ledgerVersions.length !== lineage.observedSourceMigrationCount ||
    !Array.isArray(checkpoint.migrations) ||
    checkpoint.migrations.length !== checkpoint.ledgerVersions.length
  ) {
    throw new Error("migration_lineage_source_checkpoint_invalid");
  }
  const currentByVersion = new Map(
    (manifest?.migrations ?? []).map((migration) => [migration.timestamp, migration]),
  );
  const checkpointByVersion = new Map(
    checkpoint.migrations.map((migration) => [migration.version, migration]),
  );
  const referencedVersions = [
    ...new Set(
      lineage.entries.flatMap((entry) =>
        entry.status === "equivalent"
          ? [entry.sourceVersion]
          : entry.status === "schema_proven"
            ? entry.sourceVersions
            : entry.candidateSourceVersions,
      ),
    ),
  ].sort();
  for (const version of referencedVersions) {
    const current = currentByVersion.get(version);
    const pinned = checkpointByVersion.get(version);
    if (!current || !pinned)
      throw new Error(`migration_lineage_source_checkpoint_version_missing:${version}`);
    if (current.filename !== pinned.filename || current.sha256 !== pinned.sha256)
      throw new Error(`migration_lineage_source_checkpoint_content_mismatch:${version}`);
  }
  return checkpoint;
}

function equalStringSets(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validFingerprint(value) {
  return (
    exactRecord(value, FINGERPRINT_FIELDS) &&
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
  if (!GIT_SHA.test(lineage.observedSourceCommit ?? ""))
    throw new Error("migration_lineage_source_commit_invalid");
  if (!/^[a-z0-9]{20}$/u.test(lineage.targetProjectRef ?? ""))
    throw new Error("migration_lineage_target_invalid");
  if (!Array.isArray(lineage.entries)) throw new Error("migration_lineage_entries_invalid");

  const sourceByVersion = new Map(
    (manifest?.migrations ?? []).map((migration) => [migration.timestamp, migration]),
  );
  if (
    !Number.isSafeInteger(lineage.observedSourceMigrationCount) ||
    lineage.observedSourceMigrationCount < 1 ||
    lineage.observedSourceMigrationCount > sourceByVersion.size
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
        !PROOF_ID.test(entry.proofId) ||
        !SHA256.test(entry.querySha256 ?? "") ||
        !SHA256.test(entry.scopeSha256 ?? "") ||
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
    observedSourceCommit: lineage.observedSourceCommit,
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
  if (value.schemaVersion !== 2) throw new Error("migration_schema_proof_schema_invalid");
  if (
    !exactRecord(value, [
      "schemaVersion",
      "targetProjectRef",
      "observedSourceMigrationCount",
      "observedRemoteMigrationCount",
      "sourceProvenance",
      "remoteProvenance",
      "proofs",
    ])
  ) {
    throw new Error("migration_schema_proof_invalid");
  }

  const observedRemote = validateRemoteMigrationEvidence(remoteEvidence);
  if (value.targetProjectRef !== observedRemote.targetProjectRef)
    throw new Error("migration_schema_proof_target_mismatch");
  if (value.observedSourceMigrationCount !== lineage.observedSourceMigrationCount)
    throw new Error("migration_schema_proof_source_count_mismatch");
  if (value.observedRemoteMigrationCount !== observedRemote.migrationCount)
    throw new Error("migration_schema_proof_remote_count_mismatch");
  if (!Array.isArray(value.proofs)) throw new Error("migration_schema_proof_entries_invalid");

  const sourceProvenanceFields = [
    "sourceCommit",
    "sourceTree",
    "artifactSha256",
    "artifactCreatedAt",
    "ledgerVersionsSha256",
  ];
  const remoteProvenanceFields = ["artifactSha256", "artifactCreatedAt", "ledgerVersionsSha256"];
  const sourceProvenance = value.sourceProvenance;
  const remoteProvenance = value.remoteProvenance;
  if (
    !exactRecord(sourceProvenance, sourceProvenanceFields) ||
    !GIT_SHA.test(sourceProvenance.sourceCommit ?? "") ||
    sourceProvenance.sourceCommit !== lineage.observedSourceCommit ||
    !GIT_SHA.test(sourceProvenance.sourceTree ?? "") ||
    !SHA256.test(sourceProvenance.artifactSha256 ?? "") ||
    !validUtcTimestamp(sourceProvenance.artifactCreatedAt) ||
    !SHA256.test(sourceProvenance.ledgerVersionsSha256 ?? "")
  ) {
    throw new Error("migration_schema_proof_source_provenance_invalid");
  }
  const expectedRemoteLedgerSha256 = ledgerVersionsSha256(observedRemote.versions);
  if (
    !exactRecord(remoteProvenance, remoteProvenanceFields) ||
    !SHA256.test(remoteProvenance.artifactSha256 ?? "") ||
    !validUtcTimestamp(remoteProvenance.artifactCreatedAt) ||
    remoteProvenance.ledgerVersionsSha256 !== expectedRemoteLedgerSha256
  ) {
    throw new Error("migration_schema_proof_remote_provenance_invalid");
  }

  const required = lineage.entries.filter((entry) => entry.status === "schema_proven");
  if (value.proofs.length !== required.length)
    throw new Error("migration_schema_proof_entry_count_mismatch");
  const proofs = new Map();
  for (const proof of value.proofs) {
    const captureFields = [
      "capturedAt",
      "querySha256",
      "captureSha256",
      "ledgerVersionsSha256",
      "fingerprint",
    ];
    const sourceCapture = proof?.sourceCapture;
    const remoteCapture = proof?.remoteCapture;
    if (
      !exactRecord(proof, [
        "proofId",
        "remoteVersion",
        "sourceVersions",
        "scopeSha256",
        "sourceCapture",
        "remoteCapture",
      ]) ||
      typeof proof.proofId !== "string" ||
      !PROOF_ID.test(proof.proofId) ||
      proofs.has(proof.proofId) ||
      !VERSION.test(proof.remoteVersion ?? "") ||
      !Array.isArray(proof.sourceVersions) ||
      proof.sourceVersions.length === 0 ||
      proof.sourceVersions.some((version) => !VERSION.test(version)) ||
      new Set(proof.sourceVersions).size !== proof.sourceVersions.length ||
      !SHA256.test(proof.scopeSha256 ?? "") ||
      !exactRecord(sourceCapture, captureFields) ||
      !exactRecord(remoteCapture, captureFields) ||
      !validUtcTimestamp(sourceCapture.capturedAt) ||
      !validUtcTimestamp(remoteCapture.capturedAt) ||
      !SHA256.test(sourceCapture.querySha256 ?? "") ||
      sourceCapture.querySha256 !== remoteCapture.querySha256 ||
      !SHA256.test(sourceCapture.captureSha256 ?? "") ||
      !SHA256.test(remoteCapture.captureSha256 ?? "") ||
      sourceCapture.ledgerVersionsSha256 !== sourceProvenance.ledgerVersionsSha256 ||
      remoteCapture.ledgerVersionsSha256 !== remoteProvenance.ledgerVersionsSha256 ||
      Date.parse(sourceCapture.capturedAt) > Date.parse(sourceProvenance.artifactCreatedAt) ||
      Date.parse(remoteCapture.capturedAt) > Date.parse(remoteProvenance.artifactCreatedAt) ||
      !equalFingerprint(sourceCapture.fingerprint, remoteCapture.fingerprint)
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
      proof.scopeSha256 !== entry.scopeSha256 ||
      proof.sourceCapture.querySha256 !== entry.querySha256 ||
      !equalStringSets(proofSources, expectedSources)
    ) {
      throw new Error("migration_schema_proof_entry_mismatch");
    }
  }
  return {
    proofCount: required.length,
    observedSourceMigrationCount: value.observedSourceMigrationCount,
    sourceCommit: sourceProvenance.sourceCommit,
    sourceTree: sourceProvenance.sourceTree,
    sourceArtifactSha256: sourceProvenance.artifactSha256,
    remoteArtifactSha256: remoteProvenance.artifactSha256,
    remoteLedgerVersionsSha256: expectedRemoteLedgerSha256,
  };
}

export function validateSchemaProofArtifactBindings(
  value,
  { sourceArtifactPath, remoteArtifactPath, sourceRepositoryPath = process.cwd() },
) {
  if (
    value?.schemaVersion !== 2 ||
    !Array.isArray(value?.proofs) ||
    !SHA256.test(value?.sourceProvenance?.artifactSha256 ?? "") ||
    !SHA256.test(value?.remoteProvenance?.artifactSha256 ?? "")
  ) {
    throw new Error("migration_schema_proof_artifact_binding_invalid");
  }
  const sourceBytes = readSchemaProofArtifact(sourceArtifactPath, "source");
  const remoteBytes = readSchemaProofArtifact(remoteArtifactPath, "remote");
  const sourceArtifactSha256 = sha256(sourceBytes);
  const remoteArtifactSha256 = sha256(remoteBytes);
  if (sourceArtifactSha256 !== value.sourceProvenance.artifactSha256)
    throw new Error("migration_schema_proof_source_artifact_mismatch");
  if (remoteArtifactSha256 !== value.remoteProvenance.artifactSha256)
    throw new Error("migration_schema_proof_remote_artifact_mismatch");

  let sourceArtifact;
  let remoteArtifact;
  try {
    sourceArtifact = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("migration_schema_proof_source_artifact_invalid");
  }
  try {
    remoteArtifact = JSON.parse(remoteBytes.toString("utf8"));
  } catch {
    throw new Error("migration_schema_proof_remote_artifact_invalid");
  }

  const sourceCommit = inspectMigrationSourceCommit(
    value.sourceProvenance.sourceCommit,
    sourceRepositoryPath,
  );

  if (
    !exactRecord(sourceArtifact, [
      "schemaVersion",
      "artifactKind",
      "createdAt",
      "sourceCommit",
      "sourceTree",
      "ledgerVersionsSha256",
      "ledgerVersions",
      "captures",
    ]) ||
    sourceArtifact.schemaVersion !== 1 ||
    sourceArtifact.artifactKind !== "migration-schema-source-captures" ||
    sourceArtifact.createdAt !== value.sourceProvenance.artifactCreatedAt ||
    sourceArtifact.sourceCommit !== value.sourceProvenance.sourceCommit ||
    sourceArtifact.sourceTree !== value.sourceProvenance.sourceTree ||
    sourceArtifact.sourceTree !== sourceCommit.sourceTree ||
    !validOrderedVersions(sourceArtifact.ledgerVersions, value.observedSourceMigrationCount) ||
    !equalStringSets(sourceArtifact.ledgerVersions, sourceCommit.ledgerVersions) ||
    ledgerVersionsSha256(sourceArtifact.ledgerVersions) !== sourceArtifact.ledgerVersionsSha256 ||
    sourceArtifact.ledgerVersionsSha256 !== sourceCommit.ledgerVersionsSha256 ||
    sourceArtifact.ledgerVersionsSha256 !== value.sourceProvenance.ledgerVersionsSha256 ||
    !Array.isArray(sourceArtifact.captures)
  ) {
    throw new Error("migration_schema_proof_source_artifact_invalid");
  }
  if (
    !exactRecord(remoteArtifact, [
      "schemaVersion",
      "artifactKind",
      "createdAt",
      "targetProjectRef",
      "ledgerVersionsSha256",
      "ledgerVersions",
      "captures",
    ]) ||
    remoteArtifact.schemaVersion !== 1 ||
    remoteArtifact.artifactKind !== "migration-schema-remote-captures" ||
    remoteArtifact.createdAt !== value.remoteProvenance.artifactCreatedAt ||
    remoteArtifact.targetProjectRef !== value.targetProjectRef ||
    !validOrderedVersions(remoteArtifact.ledgerVersions, value.observedRemoteMigrationCount) ||
    ledgerVersionsSha256(remoteArtifact.ledgerVersions) !== remoteArtifact.ledgerVersionsSha256 ||
    remoteArtifact.ledgerVersionsSha256 !== value.remoteProvenance.ledgerVersionsSha256 ||
    !Array.isArray(remoteArtifact.captures)
  ) {
    throw new Error("migration_schema_proof_remote_artifact_invalid");
  }

  const expectedCaptureFields = [
    "proofId",
    "remoteVersion",
    "capturedAt",
    "querySha256",
    "ledgerVersionsSha256",
    "snapshot",
  ];
  const captureMap = (artifact, side) => {
    if (artifact.captures.length !== value.proofs.length)
      throw new Error(`migration_schema_proof_${side}_artifact_invalid`);
    const captures = new Map();
    for (const capture of artifact.captures) {
      if (
        !exactRecord(capture, expectedCaptureFields) ||
        !PROOF_ID.test(capture.proofId ?? "") ||
        captures.has(capture.proofId) ||
        !VERSION.test(capture.remoteVersion ?? "") ||
        capture.snapshot?.scope?.proofId !== capture.proofId
      ) {
        throw new Error(`migration_schema_proof_${side}_artifact_invalid`);
      }
      let fingerprint;
      let captureSha256;
      let scopeSha256;
      try {
        fingerprint = fingerprintMigrationSchemaSnapshot(capture.snapshot);
        captureSha256 = digestMigrationSchemaSnapshot(capture.snapshot);
        scopeSha256 = digestMigrationSchemaScope(capture.snapshot);
      } catch {
        throw new Error(`migration_schema_proof_${side}_artifact_invalid`);
      }
      captures.set(capture.proofId, { capture, fingerprint, captureSha256, scopeSha256 });
    }
    return captures;
  };
  const sourceCaptures = captureMap(sourceArtifact, "source");
  const remoteCaptures = captureMap(remoteArtifact, "remote");
  for (const proof of value.proofs) {
    const source = sourceCaptures.get(proof.proofId);
    const remote = remoteCaptures.get(proof.proofId);
    if (
      !source ||
      !remote ||
      source.capture.remoteVersion !== proof.remoteVersion ||
      remote.capture.remoteVersion !== proof.remoteVersion ||
      !proof.sourceVersions.every((version) => sourceArtifact.ledgerVersions.includes(version)) ||
      !remoteArtifact.ledgerVersions.includes(proof.remoteVersion) ||
      source.capture.capturedAt !== proof.sourceCapture.capturedAt ||
      remote.capture.capturedAt !== proof.remoteCapture.capturedAt ||
      source.capture.querySha256 !== proof.sourceCapture.querySha256 ||
      remote.capture.querySha256 !== proof.remoteCapture.querySha256 ||
      source.capture.ledgerVersionsSha256 !== proof.sourceCapture.ledgerVersionsSha256 ||
      remote.capture.ledgerVersionsSha256 !== proof.remoteCapture.ledgerVersionsSha256 ||
      source.scopeSha256 !== proof.scopeSha256 ||
      remote.scopeSha256 !== proof.scopeSha256 ||
      source.captureSha256 !== proof.sourceCapture.captureSha256 ||
      remote.captureSha256 !== proof.remoteCapture.captureSha256 ||
      !equalFingerprint(source.fingerprint, proof.sourceCapture.fingerprint) ||
      !equalFingerprint(remote.fingerprint, proof.remoteCapture.fingerprint)
    ) {
      throw new Error("migration_schema_proof_artifact_capture_mismatch");
    }
  }
  return { sourceArtifactSha256, remoteArtifactSha256 };
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
    validateLineageSourceCheckpoint(lineage, manifest);
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
      const schemaProofEvidence = JSON.parse(readFileSync(schemaProofPath, "utf8"));
      schemaProof = {
        ...validateSchemaProofEvidence(schemaProofEvidence, lineage, remoteEvidence),
        ...validateSchemaProofArtifactBindings(schemaProofEvidence, {
          sourceArtifactPath: requiredEvidence("KOVA_MIGRATION_SCHEMA_SOURCE_ARTIFACT"),
          remoteArtifactPath: requiredEvidence("KOVA_MIGRATION_SCHEMA_REMOTE_ARTIFACT"),
        }),
      };
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
