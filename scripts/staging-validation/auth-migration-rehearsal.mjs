#!/usr/bin/env node
import { args, jsonFile, print, result } from "./lib.mjs";

const cli = args();
if (cli.help || !cli.metadata) {
  console.log(
    "Usage: node scripts/staging-validation/auth-migration-rehearsal.mjs --metadata sanitized.json [--execute-once --confirm-synthetic --allow-destination PROJECT_REF]\nPreflight only by default. Mutation requires a disposable allowlisted destination and zero row counts.",
  );
  process.exit(cli.help ? 0 : 2);
}
const meta = jsonFile(cli.metadata);
const checks = [
  { status: meta.migrationEnabled === true ? "PASS" : "BLOCKER", code: "migration_enabled" },
  {
    status:
      meta.aiGenerationDisabled === true && meta.kovaGenerationDisabled === true
        ? "PASS"
        : "BLOCKER",
    code: "generation_disabled",
  },
  {
    status: Boolean(meta.databaseSecretReference) ? "PASS" : "BLOCKER",
    code: "database_secret_reference",
  },
  { status: meta.databaseReachable === true ? "PASS" : "BLOCKER", code: "database_connectivity" },
  { status: meta.sourceSynthetic === true ? "PASS" : "BLOCKER", code: "synthetic_source" },
  {
    status:
      Number(meta.users ?? -1) === 0 && Number(meta.identities ?? -1) === 0 ? "PASS" : "BLOCKER",
    code: "empty_destination",
  },
];
if (cli["execute-once"]) {
  const allowed =
    cli["allow-destination"] &&
    cli["allow-destination"] === meta.destinationProjectRef &&
    cli["confirm-synthetic"];
  checks.push({
    status: allowed ? "PASS" : "BLOCKER",
    code: "explicit_disposable_destination_allowlist",
  });
}
print(
  result("auth-migration-rehearsal", checks, {
    phase: cli["execute-once"]
      ? "GUARDED_SYNTHETIC_MUTATION_NOT_AUTOMATICALLY_SENT"
      : "READ_ONLY_PREFLIGHT",
    destinationProjectRef: meta.destinationProjectRef,
    safeToSendAnotherRequest: false,
    reason:
      "A request is only safe after live connectivity and empty-row preflight pass immediately before an explicitly authorized one-shot invocation.",
  }),
);
