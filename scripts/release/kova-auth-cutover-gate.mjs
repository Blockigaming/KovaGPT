import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredMigrations = Object.freeze([
  "kova_owned_mfa_binding_and_global_signout",
  "kova_owned_multi_factor_login_v2",
  "kova_owned_legacy_mfa_bridge",
  "kova_owned_mcp_session_authority",
  "kova_owned_mcp_legacy_mfa_claims",
]);

export const requiredDeployedChecks = Object.freeze([
  "server_client_mode_match",
  "signing_key_and_issuer",
  "origin_and_csrf",
  "public_login_and_signup",
  "recovery_and_resend",
  "password_rotation",
  "totp_enrollment_and_login",
  "totp_recovery",
  "legacy_mfa_bridge",
  "passkey_registration",
  "passkey_login_and_removal",
  "google_callback_and_consent",
  "owned_session_revocation",
  "owner_rpc_revocation",
  "postgrest_request_hook",
  "rls_owner_isolation",
  "storage_revocation_and_url_lifetime",
  "realtime_reauthorization",
  "mcp_bearer_revocation",
  "email_delivery",
  "rollback_rehearsal",
]);

const violationFields = Object.freeze([
  "unguarded_rls_tables",
  "invalid_guard_functions",
  "browser_accessible_private_tables",
  "browser_private_schema_access",
  "missing_database_request_hook",
]);
const serviceOnlyFunctions = Object.freeze([
  "kova_auth_revoke_other_sessions",
  "kova_auth_legacy_mfa_gap_count",
  "kova_auth_activate_legacy_mfa_migration",
  "kova_auth_validate_compatibility_session",
]);
const hex = /^[a-f0-9]{64}$/u;
const commit = /^[a-f0-9]{40}$/u;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (reason) => {
  throw new Error(`kova_auth_cutover_${reason}`);
};
const timestamp = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/u.test(value)) fail(label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(label);
  return parsed;
};

export function validateCutoverEvidence(
  evidence,
  { sourceSha, environment, projectRef, configSha256, now = Date.now() },
) {
  if (!object(evidence) || !commit.test(sourceSha) || !hex.test(configSha256)) fail("inputs");
  if (
    !environment ||
    !projectRef ||
    evidence.sourceSha !== sourceSha ||
    evidence.appBuildSha !== sourceSha
  )
    fail("source");
  if (
    evidence.environment !== environment ||
    evidence.projectRef !== projectRef ||
    evidence.projectStatus !== "ACTIVE_HEALTHY" ||
    evidence.configSha256 !== configSha256 ||
    evidence.authMode !== "kova"
  )
    fail("deployment_identity");
  if (
    typeof evidence.deploymentOrigin !== "string" ||
    !/^https:\/\/[^/]+$/u.test(evidence.deploymentOrigin)
  )
    fail("deployment_origin");
  const captured = timestamp(evidence.capturedAt, "capture_time");
  if (!Number.isFinite(now) || captured > now + 60_000 || now - captured > 15 * 60_000)
    fail("stale_capture");
  if (
    !Array.isArray(evidence.appliedMigrations) ||
    requiredMigrations.some((name) => !evidence.appliedMigrations.includes(name)) ||
    new Set(evidence.appliedMigrations).size !== evidence.appliedMigrations.length
  )
    fail("migrations");
  if (evidence.legacyMfaGapCount !== 0) fail("legacy_mfa_gap");
  if (
    !object(evidence.revocationProof) ||
    !Number.isSafeInteger(evidence.revocationProof.scoped_rls_tables) ||
    evidence.revocationProof.scoped_rls_tables < 1 ||
    violationFields.some((name) => evidence.revocationProof[name] !== 0)
  )
    fail("revocation_proof");
  if (
    !object(evidence.serviceOnlyFunctions) ||
    serviceOnlyFunctions.some((name) => {
      const fn = evidence.serviceOnlyFunctions[name];
      return (
        !object(fn) ||
        fn.securityDefiner !== true ||
        fn.searchPath !== "" ||
        !Number.isSafeInteger(fn.timeoutMs) ||
        fn.timeoutMs < 1 ||
        fn.timeoutMs > 10_000 ||
        fn.serviceRoleExecute !== true ||
        fn.anonExecute !== false ||
        fn.authenticatedExecute !== false
      );
    })
  )
    fail("function_authority");
  if (
    !object(evidence.deployedChecks) ||
    requiredDeployedChecks.some((name) => evidence.deployedChecks[name] !== true)
  )
    fail("deployed_checks");
  if (
    !object(evidence.historicExpiry) ||
    timestamp(evidence.historicExpiry.preMarkerJwt, "pre_marker_expiry") > captured ||
    timestamp(evidence.historicExpiry.signedStorageUrl, "signed_url_expiry") > captured
  )
    fail("historic_expiry");
  return { sourceSha, environment, projectRef, configSha256, capturedAt: evidence.capturedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const flags = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      if (!process.argv[index]?.startsWith("--") || !process.argv[index + 1]) fail("arguments");
      flags.set(process.argv[index].slice(2), process.argv[index + 1]);
    }
    const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    if (status.trim()) fail("dirty_source");
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const evidence = JSON.parse(await readFile(flags.get("evidence"), "utf8"));
    const receipt = validateCutoverEvidence(evidence, {
      sourceSha,
      environment: flags.get("environment"),
      projectRef: flags.get("project-ref"),
      configSha256: flags.get("config-sha256"),
    });
    console.log(JSON.stringify({ ready: true, ...receipt }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "kova_auth_cutover_invalid");
    process.exitCode = 1;
  }
}
