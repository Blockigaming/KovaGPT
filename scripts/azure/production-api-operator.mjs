#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TARGET, SECRET_NAMES, runSetup } from "./provision-owned-auth.mjs";

export const APP = "kovagpt-prod-web";
export const IDENTITY = "id-kovagpt-prod";
export const PROJECT = "mfbycmbjygcfkrsuepxf";
export const OPERATIONS = ["CHECK", "CREATE_AUTH", "BIND_PROVIDER_REFERENCES", "IMPORT_RESEND"];
const root = `/subscriptions/${TARGET.subscription}/resourceGroups/${TARGET.group}/providers`;
const appId = `${root}/Microsoft.App/containerApps/${APP}`;
const vaultId = `${root}/Microsoft.KeyVault/vaults/${TARGET.vault}`;
const identityId = `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/${IDENTITY}`;
export const PROVIDERS = Object.freeze({
  "openai-api-key": "f57da173c0334cf7a37ff0fe143ce621",
  "elevenlabs-api-key": "944e3eaf18e04731a39f7cd6e6a134ba",
});
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const fail = (code) => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

export function runCli(binary, args, { json = true, env = process.env, input } = {}) {
  const extra = binary === "az" ? ["--only-show-errors", "--output", json ? "json" : "none"] : [];
  const r = spawnSync(binary, [...args, ...extra], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2_097_152,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...env, AZURE_CORE_COLLECT_TELEMETRY: "false" },
    input,
  });
  if (r.error || r.signal || r.status !== 0)
    fail(binary === "psql" ? "database_read_failed" : "azure_operation_failed");
  if (!json) return r.stdout;
  try {
    return JSON.parse(r.stdout);
  } catch {
    fail("invalid_metadata_response");
  }
}

export function validateContext(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== "Blockigaming/KovaGPT" ||
    env.GITHUB_REF !== "refs/heads/main"
  )
    fail("protected_main_dispatch_required");
  if (
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") ||
    env.GITHUB_SHA !== env.KOVA_OPERATOR_SOURCE_SHA
  )
    fail("exact_source_required");
  if (
    !OPERATIONS.includes(env.KOVA_OPERATOR_OPERATION) ||
    env.KOVA_OPERATOR_CONFIRMATION !== env.KOVA_OPERATOR_OPERATION
  )
    fail("explicit_operation_required");
  if (!uuid.test(env.KOVA_OPERATOR_AZURE_CLIENT_ID ?? ""))
    fail("existing_federated_identity_required");
}

function patternMatches(pattern, action) {
  if (typeof pattern !== "string") return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "iu").test(action);
}

export function permissionAllows(entries, action, data = false) {
  const allow = data ? "dataActions" : "actions";
  const exclude = data ? "notDataActions" : "notActions";
  return entries.some(
    (e) =>
      (e[allow] ?? []).some((p) => patternMatches(p, action)) &&
      !(e[exclude] ?? []).some((p) => patternMatches(p, action)),
  );
}

function permissions(az, resourceId) {
  const base = `https://management.azure.com${resourceId}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`;
  const entries = [];
  let url = base;
  for (let i = 0; i < 5; i++) {
    const page = az(["rest", "--method", "get", "--url", url]);
    if (!Array.isArray(page?.value)) fail("invalid_permissions_response");
    entries.push(...page.value);
    if (!page.nextLink) return entries;
    const next = new URL(page.nextLink);
    if (
      next.origin !== "https://management.azure.com" ||
      next.pathname.toLowerCase() !== new URL(base).pathname.toLowerCase()
    )
      fail("unexpected_permission_page");
    url = next.href;
  }
  fail("permissions_pagination_limit");
}

export function databaseEnvironment(raw, inherited = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail("protected_database_url_required");
  }
  const user = decodeURIComponent(u.username);
  const direct = u.hostname === `db.${PROJECT}.supabase.co` && user === "postgres";
  const pooler = /\.pooler\.supabase\.com$/u.test(u.hostname) && user === `postgres.${PROJECT}`;
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    u.pathname !== "/postgres" ||
    (!direct && !pooler) ||
    !u.password
  )
    fail("wrong_database_target");
  // Build a fresh environment instead of carrying URL options or PGOPTIONS into psql.
  return {
    PATH: inherited.PATH ?? process.env.PATH,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGDATABASE: "postgres",
    PGUSER: user,
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "/etc/ssl/certs/ca-certificates.crt",
    PGCONNECT_TIMEOUT: "15",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=15000",
  };
}

export const EMPTY_AUTH_SQL = `BEGIN READ ONLY;
SELECT (SELECT count(*) FROM kova_private.auth_accounts),
       (SELECT count(*) FROM kova_private.auth_sessions),
       (SELECT count(*) FROM kova_private.auth_mfa_factors WHERE secret_ciphertext IS NOT NULL),
       (SELECT count(*) FROM kova_private.auth_oauth_states),
       (SELECT count(*) FROM auth.users);
ROLLBACK;`;

export function checkEmptyAuth(raw, run = runCli, env = process.env) {
  const dbEnv = databaseEnvironment(raw, env);
  const output = run(
    "psql",
    ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"],
    { json: false, env: dbEnv, input: EMPTY_AUTH_SQL },
  );
  const lines = output.trim().split(/\r?\n/u);
  if (lines.length !== 1 || !/^\d+\|\d+\|\d+\|\d+\|\d+$/u.test(lines[0]))
    fail("invalid_empty_auth_result");
  const counts = lines[0].split("|").map(Number);
  if (counts.some((n) => !Number.isSafeInteger(n)) || counts.slice(0, 4).some((n) => n !== 0))
    fail("owned_auth_not_empty");
  return {
    ownedAccounts: 0,
    ownedSessions: 0,
    encryptedMfaRecords: 0,
    oauthStates: 0,
    hostedUsersPreserved: counts[4],
  };
}

export function checkAzure(env, az) {
  const account = az([
    "account",
    "show",
    "--query",
    "{subscription:id,tenant:tenantId,state:state,user:user}",
  ]);
  if (
    account?.subscription !== TARGET.subscription ||
    account?.tenant !== TARGET.tenant ||
    account?.state !== "Enabled" ||
    account?.user?.type !== "servicePrincipal" ||
    account.user.name?.toLowerCase() !== env.KOVA_OPERATOR_AZURE_CLIENT_ID.toLowerCase()
  )
    fail("wrong_federated_azure_account");
  const app = az([
    "containerapp",
    "show",
    "--name",
    APP,
    "--resource-group",
    TARGET.group,
    "--subscription",
    TARGET.subscription,
    "--query",
    "{id:id,running:properties.runningStatus,revision:properties.latestReadyRevisionName,image:properties.template.containers[0].image,identities:identity.userAssignedIdentities,secrets:properties.configuration.secrets[].{name:name,keyVaultUrl:keyVaultUrl,identity:identity}}",
  ]);
  if (
    app?.id?.toLowerCase() !== appId.toLowerCase() ||
    app.running !== "Running" ||
    !Object.keys(app.identities ?? {}).some((id) => id.toLowerCase() === identityId.toLowerCase())
  )
    fail("unexpected_production_app");
  const vault = az([
    "keyvault",
    "show",
    "--name",
    TARGET.vault,
    "--resource-group",
    TARGET.group,
    "--subscription",
    TARGET.subscription,
    "--query",
    "{id:id,tenant:properties.tenantId,rbac:properties.enableRbacAuthorization}",
  ]);
  if (vault?.id?.toLowerCase() !== vaultId.toLowerCase() || vault?.tenant !== TARGET.tenant)
    fail("wrong_vault");
  const names = az([
    "keyvault",
    "secret",
    "list",
    "--vault-name",
    TARGET.vault,
    "--subscription",
    TARGET.subscription,
    "--query",
    "[].{name:name,enabled:attributes.enabled}",
  ]);
  if (
    !Array.isArray(names) ||
    names.some((n) => typeof n?.name !== "string" || typeof n.enabled !== "boolean")
  )
    fail("invalid_vault_metadata");
  const declared = { appWrite: null, vaultSecretSet: null, vaultMetadataRead: null };
  const permissionReadErrors = [];
  try {
    declared.appWrite = permissionAllows(
      permissions(az, appId),
      "Microsoft.App/containerApps/write",
    );
  } catch {
    permissionReadErrors.push("app_permission_read_unavailable");
  }
  if (vault.rbac === true) {
    try {
      const p = permissions(az, vaultId);
      declared.vaultSecretSet = permissionAllows(
        p,
        "Microsoft.KeyVault/vaults/secrets/setSecret/action",
        true,
      );
      declared.vaultMetadataRead = permissionAllows(
        p,
        "Microsoft.KeyVault/vaults/secrets/readMetadata/action",
        true,
      );
    } catch {
      permissionReadErrors.push("vault_permission_read_unavailable");
    }
  } else permissionReadErrors.push("legacy_vault_access_policy_requires_separate_review");
  return { app, names, declared, permissionReadErrors, observedAt: new Date().toISOString() };
}

export function bindProviderReferences(observation, az) {
  if (observation.declared.appWrite !== true) fail("declared_app_write_not_established");
  const toAdd = [];
  for (const [name, version] of Object.entries(PROVIDERS)) {
    if (!observation.names.some((n) => n.name === name && n.enabled))
      fail("existing_provider_secret_missing_or_disabled");
    const expected = `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${version}`;
    const versions = az([
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
      "[].{id:id,enabled:attributes.enabled}",
    ]);
    if (!Array.isArray(versions) || !versions.some((v) => v.id === expected && v.enabled === true))
      fail("reviewed_provider_version_unavailable");
    const existing = (observation.app.secrets ?? []).find((s) => s.name === name);
    if (
      existing &&
      (existing.keyVaultUrl !== expected ||
        existing.identity?.toLowerCase() !== identityId.toLowerCase())
    )
      fail("existing_app_reference_differs_review_required");
    if (!existing) toAdd.push(`${name}=keyvaultref:${expected},identityref:${identityId}`);
  }
  if (toAdd.length) {
    try {
      az(
        [
          "containerapp",
          "secret",
          "set",
          "--name",
          APP,
          "--resource-group",
          TARGET.group,
          "--subscription",
          TARGET.subscription,
          "--secrets",
          ...toAdd,
        ],
        false,
      );
    } catch {
      fail("provider_reference_write_uncertain_inspect_before_retry");
    }
  }
  const after = az([
    "containerapp",
    "show",
    "--name",
    APP,
    "--resource-group",
    TARGET.group,
    "--subscription",
    TARGET.subscription,
    "--query",
    "{revision:properties.latestReadyRevisionName,running:properties.runningStatus,secrets:properties.configuration.secrets[].{name:name,keyVaultUrl:keyVaultUrl,identity:identity}}",
  ]);
  for (const [name, version] of Object.entries(PROVIDERS)) {
    const s = (after.secrets ?? []).find((s) => s.name === name);
    if (
      s?.keyVaultUrl !== `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${version}` ||
      s.identity?.toLowerCase() !== identityId.toLowerCase()
    )
      fail("provider_reference_verification_failed");
  }
  if (after.revision !== observation.app.revision || after.running !== "Running")
    fail("production_changed_during_reference_setup");
  return {
    referencesAdded: toAdd.map((s) => s.slice(0, s.indexOf("="))),
    existingReferencesReused: Object.keys(PROVIDERS).length - toAdd.length,
    runtimeEnvironmentApplied: false,
    providerAccessProven: false,
  };
}

export function importResend(env, observed, az) {
  if (observed.declared.vaultSecretSet !== true || observed.declared.vaultMetadataRead !== true)
    fail("declared_vault_write_not_established");
  const key = env.KOVA_OPERATOR_RESEND_KEY;
  if (typeof key !== "string" || !/^re_[A-Za-z0-9_-]{16,512}$/u.test(key))
    fail("protected_resend_input_required");
  const absent = () => {
    const active = az([
      "keyvault",
      "secret",
      "list",
      "--vault-name",
      TARGET.vault,
      "--subscription",
      TARGET.subscription,
      "--query",
      "[].name",
    ]);
    const deleted = az([
      "keyvault",
      "secret",
      "list-deleted",
      "--vault-name",
      TARGET.vault,
      "--subscription",
      TARGET.subscription,
      "--query",
      "[].name",
    ]);
    if (
      !Array.isArray(active) ||
      !Array.isArray(deleted) ||
      [...active, ...deleted].some((n) => typeof n !== "string")
    )
      fail("invalid_resend_name_inventory");
    if ([...active, ...deleted].includes("resend-api-key"))
      fail("resend_secret_exists_or_soft_deleted");
  };
  absent();
  const dir = mkdtempSync(join(tmpdir(), "kova-resend-import-"));
  chmodSync(dir, 0o700);
  try {
    const path = join(dir, "key");
    writeFileSync(path, key, { mode: 0o600, flag: "wx" });
    absent();
    try {
      az(
        [
          "keyvault",
          "secret",
          "set",
          "--vault-name",
          TARGET.vault,
          "--subscription",
          TARGET.subscription,
          "--name",
          "resend-api-key",
          "--file",
          path,
          "--content-type",
          "text/plain",
        ],
        false,
      );
    } catch {
      fail("resend_write_uncertain_inspect_before_retry");
    }
    const ids = az([
      "keyvault",
      "secret",
      "list-versions",
      "--vault-name",
      TARGET.vault,
      "--subscription",
      TARGET.subscription,
      "--name",
      "resend-api-key",
      "--query",
      "[].id",
    ]);
    const prefix = `https://${TARGET.vault}.vault.azure.net/secrets/resend-api-key/`;
    if (
      !Array.isArray(ids) ||
      ids.length !== 1 ||
      typeof ids[0] !== "string" ||
      !ids[0].startsWith(prefix) ||
      !/^[a-f0-9]{32}$/u.test(ids[0].slice(prefix.length))
    )
      fail("resend_version_verification_failed");
    return {
      secretReference: ids[0],
      providerCredentialValidated: false,
      senderDomainValidated: false,
      appBindingApplied: false,
      emailSent: false,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function executeOperator(env = process.env, dependencies = {}) {
  validateContext(env);
  const az = dependencies.azure ?? ((args, json = true) => runCli("az", args, { json }));
  const observed = checkAzure(env, az);
  const receipt = {
    ok: true,
    operation: env.KOVA_OPERATOR_OPERATION,
    sourceSha: env.GITHUB_SHA,
    observedAt: observed.observedAt,
    target: { ...TARGET, app: APP },
    productionObservation: {
      runningStatus: observed.app.running,
      readyRevision: observed.app.revision,
      configuredImage: observed.app.image ?? null,
    },
    providerReferenceState: Object.fromEntries(
      Object.entries(PROVIDERS).map(([name, version]) => {
        const slot = (observed.app.secrets ?? []).find((s) => s.name === name);
        return [
          name,
          {
            slotPresent: !!slot,
            matchesReviewedVersionAndIdentity:
              !!slot &&
              slot.keyVaultUrl ===
                `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${version}` &&
              slot.identity?.toLowerCase() === identityId.toLowerCase(),
          },
        ];
      }),
    ),
    declaredPermissions: observed.declared,
    permissionReadErrors: observed.permissionReadErrors,
    writePermissionActuallyExercised: false,
    existingProviderNames: Object.keys(PROVIDERS).filter((n) =>
      observed.names.some((s) => s.name === n && s.enabled),
    ),
    authSecretNamesPresent: SECRET_NAMES.filter((n) => observed.names.some((s) => s.name === n)),
    resendSecretPresent: observed.names.some((s) => s.name === "resend-api-key" && s.enabled),
    deployed: false,
    runtimeBindingsApplied: false,
    emailSent: false,
    generationPerformed: false,
  };
  if (env.KOVA_OPERATOR_OPERATION === "CREATE_AUTH") {
    if (observed.declared.vaultSecretSet !== true || observed.declared.vaultMetadataRead !== true)
      fail("declared_vault_write_not_established");
    if (receipt.authSecretNamesPresent.length) fail("auth_secret_already_exists");
    const empty = checkEmptyAuth(env.KOVA_OPERATOR_DATABASE_URL, dependencies.run ?? runCli, env);
    receipt.authCreation = (dependencies.setup ?? runSetup)(
      {
        execute: true,
        issuer: TARGET.issuer,
        issuerConfirmed: true,
        emptyOwnedAuthConfirmed: true,
      },
      { azure: az },
    );
    receipt.emptyAuthGuard = empty;
    receipt.writePermissionActuallyExercised = true;
  } else if (env.KOVA_OPERATOR_OPERATION === "BIND_PROVIDER_REFERENCES") {
    receipt.providerReferences = bindProviderReferences(observed, az);
    receipt.writePermissionActuallyExercised =
      receipt.providerReferences.referencesAdded.length > 0;
  } else if (env.KOVA_OPERATOR_OPERATION === "IMPORT_RESEND") {
    receipt.resendImport = importResend(env, observed, az);
    receipt.writePermissionActuallyExercised = true;
  }
  return receipt;
}

function saveReceipt(path, receipt) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let receipt;
  try {
    if (process.argv.slice(2).join(" ") !== "--execute") {
      if (process.argv.length > 2) fail("invalid_arguments");
      receipt = {
        ok: true,
        operation: "PLAN",
        availableOperations: OPERATIONS,
        azureContacted: false,
        secretsCreated: false,
      };
    } else receipt = executeOperator();
  } catch (e) {
    receipt = {
      ok: false,
      code: /^[a-z0-9_]+$/u.test(e.code ?? "") ? e.code : "operator_failed",
      completedSecretNames: e.completedSecretNames ?? [],
      uncertainSecretName: e.uncertainSecretName ?? null,
      retryAutomatically: false,
      inspectPartialStateBeforeRetry: true,
    };
    process.exitCode = 1;
  }
  try {
    saveReceipt(process.env.KOVA_OPERATOR_RECEIPT, receipt);
  } catch {
    receipt = { ok: false, code: "receipt_write_failed", retryAutomatically: false };
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
