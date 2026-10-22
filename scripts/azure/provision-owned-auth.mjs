#!/usr/bin/env node
// Private operator helper. No production operations without --execute.
import { spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  createPublicKey,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TARGET = Object.freeze({
  subscription: "ab732127-11c3-46a7-a1cb-6ee8d86594f4",
  tenant: "18a67414-b56e-4b79-8dc8-435494fcc9be",
  group: "rg-kovagpt-prod",
  vault: "kv-kovagpt-prod-d86594f4",
  issuer: "https://mfbycmbjygcfkrsuepxf.supabase.co/auth/v1",
});
export const SECRET_NAMES = Object.freeze([
  "kova-auth-jwt-private-key",
  "kova-auth-jwt-private-jwk",
  "kova-auth-encryption-key",
  "kova-email-worker-secret",
  "kova-auth-jwt-key-id",
  "kova-auth-jwt-public-key-sha256",
  "kova-auth-encryption-key-sha256",
  "kova-auth-issuer",
]);
class SetupError extends Error {
  constructor(code, completed = []) {
    super(code);
    this.code = code;
    this.completedSecretNames = [...completed];
    this.uncertainSecretName = null;
  }
}
const fail = (code) => {
  throw new SetupError(code);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseArgs(args) {
  const options = { execute: false, issuerConfirmed: false, emptyOwnedAuthConfirmed: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--issuer") options.issuer = args[++i];
    else if (arg === "--confirm-project-issuer") options.issuerConfirmed = true;
    else if (arg === "--confirm-empty-owned-auth") options.emptyOwnedAuthConfirmed = true;
    else fail("invalid_arguments");
  }
  return options;
}

export function dryPlan() {
  return {
    ok: true,
    operation: "plan_only",
    target: TARGET,
    proposedSecretNames: SECRET_NAMES,
    createsOnlyWhenAllNamesAbsent: true,
    refusesActiveOrSoftDeletedNames: true,
    requiresConfirmedEmptyOwnedAuth: true,
    issuerRequiresExplicitConfirmation: true,
    importsSigningTrust: false,
    changesApp: false,
    sendsEmail: false,
    note: "Execution generates private credentials. Owner executes the browser handoff. No Resend/provider key creation or reads. Existing hosted users stay unchanged. Azure Key Vault has no atomic create-if-absent secret API; one exclusive operator is required. Partial writes are retained, never deleted or overwritten automatically.",
  };
}

function realAzure(args, json = true) {
  const response = spawnSync(
    "az",
    [...args, "--only-show-errors", "--output", json ? "json" : "none"],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1_048_576,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (response.error || response.signal || response.status !== 0) fail("azure_command_failed");
  if (!json) return null;
  try {
    return JSON.parse(response.stdout);
  } catch {
    fail("azure_metadata_invalid");
  }
}

function generateMaterial(issuer) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = createPublicKey(privateKey);
  const kid = randomUUID();
  const jwk = { ...privateKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const aes = randomBytes(32);
  const signingFingerprint = hash(publicKey.export({ format: "der", type: "spki" }));
  const encryptionFingerprint = hash(aes);
  const values = [
    privateKey.export({ format: "pem", type: "pkcs8" }),
    JSON.stringify(jwk),
    aes.toString("base64url"),
    randomBytes(48).toString("base64url"),
    kid,
    signingFingerprint,
    encryptionFingerprint,
    issuer,
  ];
  aes.fill(0);
  return { values, kid, signingFingerprint, encryptionFingerprint };
}

export function runSetup(options, dependencies = {}) {
  if (!options.execute) return dryPlan();
  if (options.issuer !== TARGET.issuer || !options.issuerConfirmed)
    fail("explicit_project_issuer_required");
  if (!options.emptyOwnedAuthConfirmed) fail("empty_owned_auth_confirmation_required");
  if (Number(process.versions.node.split(".")[0]) < 24) fail("node24_required");
  const azure = dependencies.azure ?? realAzure;
  const generate = dependencies.generate ?? generateMaterial;
  const account = azure([
    "account",
    "show",
    "--query",
    "{subscription:id,tenant:tenantId,state:state}",
  ]);
  if (
    account?.subscription !== TARGET.subscription ||
    account?.tenant !== TARGET.tenant ||
    account?.state !== "Enabled"
  )
    fail("wrong_azure_account");
  const vault = azure([
    "keyvault",
    "show",
    "--name",
    TARGET.vault,
    "--resource-group",
    TARGET.group,
    "--subscription",
    TARGET.subscription,
    "--query",
    "{id:id,tenant:properties.tenantId}",
  ]);
  const vaultId = `/subscriptions/${TARGET.subscription}/resourceGroups/${TARGET.group}/providers/Microsoft.KeyVault/vaults/${TARGET.vault}`;
  if (vault?.id?.toLowerCase() !== vaultId.toLowerCase() || vault?.tenant !== TARGET.tenant)
    fail("wrong_vault");
  const completed = [];
  const checkAbsent = () => {
    const common = [
      "--vault-name",
      TARGET.vault,
      "--subscription",
      TARGET.subscription,
      "--query",
      "[].name",
    ];
    const active = azure(["keyvault", "secret", "list", ...common]);
    const deleted = azure(["keyvault", "secret", "list-deleted", ...common]);
    if (
      !Array.isArray(active) ||
      !Array.isArray(deleted) ||
      [...active, ...deleted].some((n) => typeof n !== "string")
    )
      fail("invalid_secret_inventory");
    const foreignTarget = active.find((n) => SECRET_NAMES.includes(n) && !completed.includes(n));
    if (foreignTarget) fail("target_secret_already_exists");
    if (deleted.some((n) => SECRET_NAMES.includes(n))) fail("target_secret_soft_deleted");
  };
  checkAbsent(); // Never generate key material before every target name is absent.
  let directory;
  let material;
  let pendingName = null;
  try {
    material = generate(options.issuer);
    if (
      !material ||
      !Array.isArray(material.values) ||
      material.values.length !== SECRET_NAMES.length ||
      material.values.some((v) => typeof v !== "string" || !v)
    )
      fail("generated_material_invalid");
    directory = mkdtempSync(join(dependencies.temporaryRoot ?? tmpdir(), "kova-auth-first-"));
    chmodSync(directory, 0o700);
    const references = {};
    for (let i = 0; i < SECRET_NAMES.length; i++) {
      checkAbsent();
      const name = SECRET_NAMES[i];
      const path = join(directory, `entry-${i}`);
      writeFileSync(path, material.values[i], { mode: 0o600, flag: "wx" });
      const type =
        i === 0 ? "application/pkcs8-pem" : i === 1 ? "application/jwk+json" : "text/plain";
      pendingName = name;
      azure(
        [
          "keyvault",
          "secret",
          "set",
          "--vault-name",
          TARGET.vault,
          "--subscription",
          TARGET.subscription,
          "--name",
          name,
          "--file",
          path,
          "--content-type",
          type,
        ],
        false,
      );
      completed.push(name);
      pendingName = null;
      rmSync(path);
      const ids = azure([
        "keyvault",
        "secret",
        "list-versions",
        "--vault-name",
        TARGET.vault,
        "--subscription",
        TARGET.subscription,
        "--name",
        name,
        "--query",
        "[].id",
      ]);
      const prefix = `https://${TARGET.vault}.vault.azure.net/secrets/${name}/`;
      if (
        !Array.isArray(ids) ||
        ids.length !== 1 ||
        typeof ids[0] !== "string" ||
        !ids[0].startsWith(prefix) ||
        !/^[a-f0-9]{32}$/iu.test(ids[0].slice(prefix.length))
      )
        fail("unexpected_secret_version_state");
      references[name] = ids[0];
    }
    return {
      ok: true,
      operation: "created_first_owned_auth_secrets",
      target: TARGET,
      createdAt: new Date().toISOString(),
      secretReferences: references,
      keyId: material.kid,
      signingSpkiSha256: material.signingFingerprint,
      encryptionRawBytesSha256: material.encryptionFingerprint,
      privateValuesPrinted: false,
      localPrivateFilesRemoved: true,
      signingImportPerformed: false,
      backendTrustVerified: false,
      appBindingsApplied: false,
      deployed: false,
      emailsSent: false,
    };
  } catch (error) {
    const sanitized = new SetupError(
      error instanceof SetupError ? error.code : "private_setup_failed",
      completed,
    );
    sanitized.uncertainSecretName = pendingName;
    throw sanitized;
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (material?.values) material.values.fill(null);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(runSetup(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, code: error instanceof SetupError ? error.code : "private_setup_failed", completedSecretNames: error instanceof SetupError ? error.completedSecretNames : [], uncertainSecretName: error instanceof SetupError ? error.uncertainSecretName : null, retryAutomatically: false })}\n`,
    );
    process.exitCode = 1;
  }
}
