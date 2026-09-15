import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`auth_migration_invalid_${name}`);
  return value;
}

export function validateAuthMigrationEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1)
    throw new Error("auth_migration_evidence_schema_invalid");
  const sourceUsers = integer(value.sourceUsers, "source_users");
  const sourceIdentities = integer(value.sourceIdentities, "source_identities");
  const destinationUsersBefore = integer(value.destinationUsersBefore, "destination_users_before");
  const destinationIdentitiesBefore = integer(
    value.destinationIdentitiesBefore,
    "destination_identities_before",
  );
  const orphanIdentities = integer(value.orphanIdentities, "orphan_identities");
  const duplicateProviderSubjects = integer(
    value.duplicateProviderSubjects,
    "duplicate_provider_subjects",
  );
  if (value.tlsAuthorized !== true) throw new Error("auth_migration_tls_not_authorized");
  if (orphanIdentities !== 0) throw new Error("auth_migration_orphan_identities_present");
  if (duplicateProviderSubjects !== 0) {
    throw new Error("auth_migration_duplicate_provider_subjects_present");
  }
  if (!Array.isArray(value.expectedUserUuids)) {
    throw new Error("auth_migration_expected_uuids_invalid");
  }
  if (value.expectedUserUuids.length !== sourceUsers) {
    throw new Error("auth_migration_expected_uuid_count_mismatch");
  }
  const expectedUuids = new Set();
  for (const id of value.expectedUserUuids) {
    // Iteration also visits sparse entries; regex alone would coerce arrays/objects.
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new Error("auth_migration_expected_uuids_invalid");
    }
    const canonicalId = id.toLowerCase();
    if (expectedUuids.has(canonicalId)) {
      throw new Error("auth_migration_expected_uuids_duplicate");
    }
    expectedUuids.add(canonicalId);
  }
  if (sourceUsers === 0 && sourceIdentities !== 0) {
    throw new Error("auth_migration_source_counts_inconsistent");
  }

  const databaseState = `${destinationUsersBefore}|${destinationIdentitiesBefore}`;
  const completed =
    destinationUsersBefore === sourceUsers &&
    destinationIdentitiesBefore === sourceIdentities &&
    value.destinationMatchesExpected === true;
  if (completed) {
    return {
      decision: "DO_NOT_RERUN",
      databaseState,
      sourceUsers,
      sourceIdentities,
    };
  }
  if (destinationUsersBefore !== 0 || destinationIdentitiesBefore !== 0) {
    throw new Error("auth_migration_destination_not_empty_or_complete");
  }
  if (value.exactlyOnceApproved !== true)
    throw new Error("auth_migration_exactly_once_not_approved");
  if (typeof value.backupReference !== "string" || !value.backupReference.trim()) {
    throw new Error("auth_migration_backup_reference_missing");
  }
  if (typeof value.rollbackPlan !== "string" || !value.rollbackPlan.trim()) {
    throw new Error("auth_migration_rollback_plan_missing");
  }
  return {
    decision: "READY_FOR_REHEARSAL_OR_APPROVED_RUN",
    databaseState,
    sourceUsers,
    sourceIdentities,
  };
}

// Bound reads before decoding. Failed evidence must never be echoed into CI or chat logs.
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

function readEvidenceFile(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_EVIDENCE_BYTES) {
      throw new Error("auth_migration_evidence_input_invalid");
    }
    const bytes = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    if (used > MAX_EVIDENCE_BYTES) {
      throw new Error("auth_migration_evidence_input_invalid");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used));
    return JSON.parse(text);
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error("auth_migration_evidence_input_invalid");
    const path = process.env.KOVA_AUTH_MIGRATION_EVIDENCE_FILE ?? process.argv[2];
    if (!path) throw new Error("auth_migration_evidence_file_required");
    const result = validateAuthMigrationEvidence(readEvidenceFile(path));
    console.log(`AUTH_MIGRATION_PREFLIGHT=${JSON.stringify(result)}`);
  } catch (error) {
    // Only application-defined fixed codes are public; no paths, SQL, JSON, or stack traces.
    const code =
      error instanceof Error && /^auth_migration_[a-z_]+$/u.test(error.message)
        ? error.message
        : "auth_migration_evidence_input_invalid";
    console.error(`AUTH_MIGRATION_PREFLIGHT_ERROR=${code}`);
    process.exitCode = 1;
  }
}
