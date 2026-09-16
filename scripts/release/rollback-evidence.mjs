import { readFileSync, writeFileSync } from "node:fs";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TEMPLATE_MARKER = /REPLACE_WITH/iu;

export function validateRollbackEvidence(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["evidenceObject"];
  }
  const errors = [];
  if (typeof value.releaseSha !== "string" || !SHA.test(value.releaseSha)) {
    errors.push("releaseSha");
  }
  for (const name of ["candidateImageDigest", "previousImageDigest"]) {
    if (typeof value[name] !== "string" || !DIGEST.test(value[name])) errors.push(name);
  }
  for (const name of [
    "candidateRevision",
    "previousRevision",
    "backupReference",
    "databaseCompatibility",
    "authMigrationState",
    "cloudflareOriginState",
    "restoreCommand",
    "verificationCommand",
  ]) {
    if (
      typeof value[name] !== "string" ||
      !value[name].trim() ||
      TEMPLATE_MARKER.test(value[name])
    ) {
      errors.push(name);
    }
  }
  if (value?.candidateImageDigest === value?.previousImageDigest)
    errors.push("distinctImageDigests");
  return errors;
}

const template = {
  schemaVersion: 1,
  releaseSha: "REPLACE_WITH_40_HEX_SHA",
  candidateImageDigest: "sha256:REPLACE_WITH_64_HEX_DIGEST",
  previousImageDigest: "sha256:REPLACE_WITH_64_HEX_DIGEST",
  candidateRevision: "REPLACE_WITH_CANDIDATE_REVISION",
  previousRevision: "REPLACE_WITH_PREVIOUS_HEALTHY_REVISION",
  backupReference: "REPLACE_WITH_DATABASE_BACKUP_OR_PITR_REFERENCE",
  databaseCompatibility: "REPLACE_WITH_FORWARD_BACKWARD_COMPATIBILITY_DECISION",
  authMigrationState: "not_started",
  cloudflareOriginState: "REPLACE_WITH_CURRENT_ORIGIN_AND_DNS_STATE",
  restoreCommand: "REPLACE_WITH_REVIEWED_AZURE_TRAFFIC_OR_REVISION_COMMAND",
  verificationCommand: "REPLACE_WITH_HEALTH_VERSION_AUTH_SMOKE_COMMAND",
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const writeIndex = process.argv.indexOf("--write-template");
  if (writeIndex >= 0) {
    const path = process.argv[writeIndex + 1];
    if (!path) throw new Error("rollback_template_path_required");
    writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`);
    console.log(`ROLLBACK_TEMPLATE_WRITTEN=${path}`);
    process.exit(0);
  }
  const path = process.env.KOVA_ROLLBACK_EVIDENCE_FILE ?? process.argv[2];
  if (!path) throw new Error("rollback_evidence_file_required");
  const errors = validateRollbackEvidence(JSON.parse(readFileSync(path, "utf8")));
  if (errors.length) throw new Error(`rollback_evidence_invalid:${errors.join(",")}`);
  console.log("ROLLBACK_EVIDENCE_CONTRACT=PASS productionExerciseStillRequired=true");
}
