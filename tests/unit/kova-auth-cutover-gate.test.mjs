import assert from "node:assert/strict";
import test from "node:test";
import {
  requiredDeployedChecks,
  requiredMigrations,
  validateCutoverEvidence,
} from "../../scripts/release/kova-auth-cutover-gate.mjs";

const sourceSha = "a".repeat(40);
const configSha256 = "b".repeat(64);
const capturedAt = "2026-09-24T21:00:00.000Z";
const options = {
  sourceSha,
  configSha256,
  environment: "Auth Rehearsal",
  projectRef: "oztdrjtdglkizlewnulh",
  now: Date.parse(capturedAt) + 30_000,
};

const evidence = () => ({
  sourceSha,
  appBuildSha: sourceSha,
  configSha256,
  environment: options.environment,
  projectRef: options.projectRef,
  projectStatus: "ACTIVE_HEALTHY",
  authMode: "kova",
  deploymentOrigin: "https://rehearsal.example.invalid",
  authPublicOrigin: "https://rehearsal.example.invalid",
  passkeyRpId: "rehearsal.example.invalid",
  capturedAt,
  appliedMigrations: [...requiredMigrations],
  legacyMfaGapCount: 0,
  legacyAdoptionGapCount: 0,
  revocationProof: {
    scoped_rls_tables: 119,
    unguarded_rls_tables: 0,
    invalid_guard_functions: 0,
    browser_accessible_private_tables: 0,
    browser_private_schema_access: 0,
    missing_database_request_hook: 0,
  },
  serviceOnlyFunctions: Object.fromEntries(
    [
      "kova_auth_revoke_other_sessions",
      "kova_auth_legacy_mfa_gap_count",
      "kova_auth_legacy_adoption_gap_count",
      "kova_auth_activate_legacy_mfa_migration",
      "kova_auth_validate_compatibility_session",
    ].map((name) => [
      name,
      {
        securityDefiner: true,
        searchPath: "",
        timeoutMs: 5000,
        ...(name === "kova_auth_legacy_adoption_gap_count"
          ? { argumentTypes: "text,timestamptz" }
          : {}),
        serviceRoleExecute: true,
        anonExecute: false,
        authenticatedExecute: false,
      },
    ]),
  ),
  deployedChecks: Object.fromEntries(requiredDeployedChecks.map((name) => [name, true])),
  historicExpiry: {
    preMarkerJwt: "2026-09-24T20:00:00.000Z",
    signedStorageUrl: "2026-09-24T20:59:59.000Z",
  },
});

test("cutover receipt binds the deployed build, live database and fresh evidence", () => {
  assert.deepEqual(validateCutoverEvidence(evidence(), options), {
    sourceSha,
    configSha256,
    environment: options.environment,
    projectRef: options.projectRef,
    capturedAt,
  });
  for (const [field, value] of [
    ["sourceSha", "c".repeat(40)],
    ["appBuildSha", "c".repeat(40)],
    ["configSha256", "c".repeat(64)],
    ["projectRef", "mfbycmbjygcfkrsuepxf"],
    ["projectStatus", "INACTIVE"],
    ["authMode", "dual"],
    ["authPublicOrigin", "http://rehearsal.example.invalid"],
    ["passkeyRpId", "old.rehearsal.example.invalid"],
  ]) {
    const altered = evidence();
    altered[field] = value;
    assert.throws(() => validateCutoverEvidence(altered, options), /kova_auth_cutover_/u, field);
  }
  assert.throws(
    () => validateCutoverEvidence(evidence(), { ...options, now: options.now + 16 * 60_000 }),
    /stale_capture/u,
  );
});

test("cutover receipt fails closed on missing proof, public function access and unexpired tokens", () => {
  const mutations = [
    (item) => item.appliedMigrations.pop(),
    (item) => (item.legacyMfaGapCount = 1),
    (item) => (item.legacyAdoptionGapCount = 1),
    (item) => delete item.legacyAdoptionGapCount,
    (item) => delete item.passkeyRpId,
    (item) =>
      (item.serviceOnlyFunctions.kova_auth_legacy_adoption_gap_count.argumentTypes = "timestamptz"),
    (item) => (item.deployedChecks.hosted_bearer_denied_after_retirement = false),
    (item) => (item.revocationProof.unguarded_rls_tables = 1),
    (item) => (item.revocationProof.scoped_rls_tables = 0),
    (item) =>
      (item.serviceOnlyFunctions.kova_auth_validate_compatibility_session.anonExecute = true),
    (item) => (item.serviceOnlyFunctions.kova_auth_activate_legacy_mfa_migration.timeoutMs = 0),
    (item) => (item.deployedChecks.realtime_reauthorization = false),
    (item) => (item.historicExpiry.signedStorageUrl = "2026-09-24T21:01:00.000Z"),
    (item) => (item.historicExpiry.preMarkerJwt = "2026-09-24T21:01:00.000Z"),
  ];
  for (const mutate of mutations) {
    const item = evidence();
    mutate(item);
    assert.throws(() => validateCutoverEvidence(item, options), /kova_auth_cutover_/u);
  }
});
