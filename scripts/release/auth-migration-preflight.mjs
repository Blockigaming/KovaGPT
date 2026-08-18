import { readFileSync } from "node:fs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function integer(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`auth_migration_invalid_${name}`);
  return value;
}

export function validateAuthMigrationEvidence(value) {
  if (!value || value.schemaVersion !== 1)
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
  if (
    !Array.isArray(value.expectedUserUuids) ||
    !value.expectedUserUuids.every((id) => UUID.test(id))
  ) {
    throw new Error("auth_migration_expected_uuids_invalid");
  }
  if (value.expectedUserUuids.length !== sourceUsers) {
    throw new Error("auth_migration_expected_uuid_count_mismatch");
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.env.KOVA_AUTH_MIGRATION_EVIDENCE_FILE ?? process.argv[2];
  if (!path) throw new Error("auth_migration_evidence_file_required");
  const result = validateAuthMigrationEvidence(JSON.parse(readFileSync(path, "utf8")));
  console.log(`AUTH_MIGRATION_PREFLIGHT=${JSON.stringify(result)}`);
}
