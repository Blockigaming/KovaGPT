import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  digestMigrationSchemaSnapshot,
  fingerprintMigrationSchemaSnapshot,
} from "./migration-schema-fingerprint.mjs";

// This opt-in method does not modify, bypass or promote the existing v2 lineage.
// Only an actual, independently reviewed isolated execution can pass verification.
// Private captures are caller-supplied files, never repository fixtures or output.
export const CONNECTOR_PROOF_ID = "proof-20260823215619";
export const CONNECTOR_METHOD = "connector-paired-later-writer-v1";
export const CONNECTOR_AMENDMENT_SHA256 =
  "ace1a79c3bc7eef294e35b70d8badb21b1b13e1dca25dbd93bbdf7b694163f6f";
export const CONNECTOR_COLLECTOR_SHA256 =
  "172e18c993fe5a4138e7019f734731dae9e0a54d4a62a8e6238686c0fb0e0889";
export const CONNECTOR_PRESTATE_MANIFEST_SHA256 =
  "5ccccc2a81c1c630cfffa7eb741c1aa046a4d4fa63b55bd8f9181381e5825baa";
export const CONNECTOR_SOURCE = Object.freeze({
  commit: "eb5596c77bc6309dc4856b716ac7f4143add13c1",
  tree: "63e543e367a1ffa7d1165544d1ba8b869dbfe263",
  ledgerCount: 157,
  ledgerSha256: "e02be4c1e49b7a41da8c81ab37cf09726eeaa24ada19625742a9fe5414766973",
});
export const CONNECTOR_RELATIONS = Object.freeze([
  "public.connected_account_audit_log",
  "public.connected_accounts",
  "public.github_accounts",
  "public.github_coding_selections",
  "public.github_installations",
  "public.github_repositories",
  "public.github_repository_branches",
  "public.github_sync_records",
  "public.github_tool_audit",
  "public.github_webhooks",
  "public.google_oauth_tokens",
  "public.integration_action_approvals",
  "public.integration_audit_events",
  "public.integration_consents",
  "public.integration_deletion_requests",
  "public.integration_linked_accounts",
  "public.integration_sync_jobs",
]);
export const CONNECTOR_SQL = Object.freeze({
  remote: Object.freeze([
    {
      version: "20260823215619",
      sha256: "5416605070fd945ceb3651888cca3b1869d2799acace28cb3b862c293a437d32",
    },
  ]),
  source: Object.freeze([
    {
      version: "20260823220903",
      sha256: "e73e51390a379e3b2038e6bea62ed06a23b8e3dd5ecbae5200089ee9150ee9e3",
    },
    {
      version: "20260903145843",
      sha256: "7f479d52a2fddc859d1603932c8b59dbe8b481bcd77e3062b3b94427a631689d",
    },
    {
      version: "20260904230329",
      sha256: "fa68fc4d3b731e9b5d04980dbb655c7c7258aebfd8f926be57bb6c74bc1947b1",
    },
  ]),
  laterWriters: Object.freeze([
    {
      version: "20260905001247",
      sha256: "8b2f7518844fb5f5228d18b2c292b8c7bf778fad43ba8b8a2b87985db6db87a4",
    },
    {
      version: "20260905005417",
      sha256: "f255ce1982f740949916d53c3659fd8367b7702f2fb39ed354de50a64a1f6733",
    },
  ]),
});
export const CONNECTOR_HISTORICAL_ARTIFACTS = Object.freeze({
  historicalSource: "a4b7ff311c971d8489bbe4ca07ced4a44079b393467691ecca23deb8da2be109",
  historicalRemote: "b42d2fc210a1f2f444469bde6213ae3679d532782ac61ea87b75db909d9658ea",
  authenticatedCapture: "07e0ac7910c7eb78eb1a8a4de95a9a27241225c9edbd6f7ff1348a26e8e5a7d1",
  sourcePreimageBridge: "986dff1acf645047e696bae562920f4fe2d97cb63d710552f1bf7d7f8fbd4b9e",
});
for (const entries of Object.values(CONNECTOR_SQL)) {
  for (const entry of entries) Object.freeze(entry);
}
export const CONNECTOR_ARTIFACT_KEYS = Object.freeze([
  ...Object.keys(CONNECTOR_HISTORICAL_ARTIFACTS),
  "commonPrestate",
  "remoteExecution",
  "sourceExecution",
  "remoteCapture",
  "sourceCapture",
  "compatibility",
  "rollback",
  "independentReview",
]);
export const CONNECTOR_REQUIRED_CHECKS = Object.freeze([
  "complete-table-column-grant-matrix",
  "connector-allowed-denied-operations",
  "policy-identity-equivalence",
  "helper-schema-execute-closure",
  "token-owner-subject-uniqueness",
  "token-selection-cascade",
  "token-client-denied",
  "token-lifecycle-stale-revision",
  "approval-owner-binding",
  "approval-cross-owner-denied",
  "account-deletion-protection",
  "shared-entitlements-preserved",
  "later-writer-rollback",
]);
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const ROLES = ["anon", "authenticated", "service_role"];
const MAX_BYTES = 4 * 1024 * 1024;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function requireValue(condition, code) {
  if (!condition) throw new Error(`connector_proof_${code}`);
}
function exactKeys(value, keys) {
  return record(value) && same(Object.keys(value).sort(), [...keys].sort());
}
function scoped(value) {
  return same(value, CONNECTOR_RELATIONS);
}
function timestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function jsonbText(value) {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort(
        (a, b) =>
          Buffer.byteLength(a) - Buffer.byteLength(b) ||
          Buffer.compare(Buffer.from(a), Buffer.from(b)),
      )
      .map((key) => `${JSON.stringify(key)}: ${jsonbText(value[key])}`)
      .join(", ")}}`;
  }
  requireValue(
    value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)),
    "json_value_invalid",
  );
  return JSON.stringify(value);
}
function safeReference(ref) {
  return (
    exactKeys(ref, ["path", "sha256"]) &&
    SHA.test(ref.sha256) &&
    typeof ref.path === "string" &&
    ref.path.length > 0 &&
    !isAbsolute(ref.path) &&
    !ref.path.includes("\\") &&
    !ref.path.includes("\0") &&
    ref.path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Offline only. Never logs the payload or accepts a hash without reading bytes. */
export function readConnectorArtifactBytes(root, ref) {
  requireValue(safeReference(ref), "artifact_reference_invalid");
  let bytes;
  try {
    const directory = realpathSync(root);
    let path = directory;
    for (const component of ref.path.split("/")) {
      path = join(path, component);
      requireValue(!lstatSync(path).isSymbolicLink(), "artifact_symlink");
    }
    const actual = realpathSync(path);
    requireValue(
      !relative(directory, actual).startsWith(`..${sep}`) && actual !== directory,
      "artifact_outside_root",
    );
    const stat = lstatSync(actual);
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES, "artifact_size_invalid");
    bytes = readFileSync(actual);
  } catch (error) {
    if (/^connector_proof_[a-z_]+$/u.test(error.message)) throw error;
    throw new Error("connector_proof_artifact_unavailable");
  }
  requireValue(sha(bytes) === ref.sha256, "artifact_hash_mismatch");
  return bytes;
}
export function readConnectorArtifact(root, ref) {
  const bytes = readConnectorArtifactBytes(root, ref);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("connector_proof_artifact_json_invalid");
  }
}

/** A structurally valid packet is NOT executed or accepted evidence. */
export function validateConnectorMappingContract(value) {
  requireValue(
    exactKeys(value, [
      "schemaVersion",
      "method",
      "proofId",
      "amendmentSha256",
      "attemptId",
      "scope",
      "source",
      "remoteLedgerCount",
      "artifacts",
    ]),
    "contract_invalid",
  );
  requireValue(
    value.schemaVersion === 3 &&
      value.method === CONNECTOR_METHOD &&
      value.proofId === CONNECTOR_PROOF_ID,
    "method_invalid",
  );
  requireValue(value.amendmentSha256 === CONNECTOR_AMENDMENT_SHA256, "amendment_mismatch");
  requireValue(UUID.test(value.attemptId), "attempt_invalid");
  requireValue(scoped(value.scope), "scope_mismatch");
  requireValue(
    same(value.source, CONNECTOR_SOURCE) && value.remoteLedgerCount === 98,
    "historical_pin_mismatch",
  );
  requireValue(exactKeys(value.artifacts, CONNECTOR_ARTIFACT_KEYS), "artifact_inventory_invalid");
  requireValue(Object.values(value.artifacts).every(safeReference), "artifact_reference_invalid");
  requireValue(
    new Set(Object.values(value.artifacts).map((ref) => ref.path)).size ===
      CONNECTOR_ARTIFACT_KEYS.length,
    "artifact_alias",
  );
  for (const [name, expected] of Object.entries(CONNECTOR_HISTORICAL_ARTIFACTS))
    requireValue(value.artifacts[name].sha256 === expected, "historical_artifact_mismatch");
  return {
    status: "CONTRACT_VALID_NOT_EXECUTED",
    schemaProofAccepted: false,
    proofId: CONNECTOR_PROOF_ID,
  };
}

export function connectorReviewSubjectSha256(value) {
  validateConnectorMappingContract(value);
  const artifacts = Object.fromEntries(
    CONNECTOR_ARTIFACT_KEYS.filter((key) => key !== "independentReview").map((key) => [
      key,
      value.artifacts[key],
    ]),
  );
  return sha(JSON.stringify({ ...value, artifacts }));
}

function validateHistoricalArtifacts(artifacts) {
  const {
    historicalSource: source,
    historicalRemote: remote,
    authenticatedCapture: current,
    sourcePreimageBridge: bridge,
  } = artifacts;
  requireValue(
    source.sourceCommit === CONNECTOR_SOURCE.commit &&
      source.sourceTree === CONNECTOR_SOURCE.tree &&
      source.ledgerVersionsSha256 === CONNECTOR_SOURCE.ledgerSha256,
    "historical_source_binding",
  );
  requireValue(
    current.ledgerVersions.length === 98 && same(current.ledgerVersions, remote.ledger.versions),
    "historical_remote_ledger",
  );
  requireValue(
    scoped(current.relations.map((row) => row.object_id)) &&
      current.readOnly === true &&
      current.isolation === "repeatable read" &&
      Math.floor(current.postgresVersionNum / 10000) === 17,
    "authenticated_capture_invalid",
  );
  requireValue(
    bridge.sourceCommit === CONNECTOR_SOURCE.commit && bridge.unresolved.length === 0,
    "preimage_bridge_incomplete",
  );
  const sourceRows = new Map(source.capture.relations.map((row) => [row.object_id, row]));
  const remoteRows = new Map(remote.relations.map((row) => [row.object_id, row]));
  const differences = [];
  for (const row of current.relations) {
    for (const category of ["schema", "acl", "rls"]) {
      const currentHash = sha(jsonbText(row[`${category}Detail`]));
      requireValue(
        currentHash === row[`${category}_sha256`] &&
          currentHash === remoteRows.get(row.object_id)?.[`${category}_sha256`],
        "remote_preimage_mismatch",
      );
      const historical = sourceRows.get(row.object_id)?.[`${category}_sha256`];
      if (historical !== currentHash) {
        const matches = bridge.recovered.filter(
          (item) => item.object === row.object_id && item.category === category,
        );
        requireValue(
          matches.length === 1 &&
            sha(jsonbText(matches[0].preimage)) === historical &&
            matches[0].expectedSourceSha256 === historical,
          "source_preimage_mismatch",
        );
        differences.push(`${row.object_id}:${category}`);
      }
    }
  }
  const expected = CONNECTOR_RELATIONS.filter((name) => name !== "public.google_oauth_tokens").map(
    (name) => `${name}:rls`,
  );
  expected.push(
    "public.google_oauth_tokens:schema",
    "public.google_oauth_tokens:acl",
    "public.integration_action_approvals:schema",
  );
  requireValue(same(differences.sort(), expected.sort()), "difference_witness_mismatch");
}

function actualReceipt(value, bundle, kind) {
  requireValue(
    record(value) &&
      value.schemaVersion === 1 &&
      value.kind === kind &&
      value.executionMode === "ACTUAL_ISOLATED_LOCAL" &&
      value.attemptId === bundle.attemptId &&
      value.status === "PASS",
    "actual_execution_required",
  );
  requireValue(
    timestamp(value.startedAt) &&
      timestamp(value.completedAt) &&
      Date.parse(value.completedAt) >= Date.parse(value.startedAt),
    "receipt_clock_invalid",
  );
  requireValue(
    value.productionReads === 0 &&
      value.productionWrites === 0 &&
      value.incrementalSpendUsd === 0 &&
      value.sevenDotSqlExecuted === false,
    "execution_scope_violation",
  );
}

// The seed is the complete approved manifest minus this mapping, never a
// hand-selected subset of grants. These are byte checks, not SQL execution.
function validatePrestateInputs(prestate, bundle, readEvidence, readBytes) {
  const inputs = prestate.inputs;
  requireValue(
    exactKeys(inputs, ["manifest", "ledger", "roles", "seedSql"]) &&
      [inputs.manifest, inputs.ledger, inputs.roles].every(safeReference) &&
      inputs.manifest.sha256 === CONNECTOR_PRESTATE_MANIFEST_SHA256,
    "prestate_manifest_binding",
  );
  const manifest = readEvidence(inputs.manifest);
  requireValue(
    manifest?.schemaVersion === 1 &&
      manifest.productionVersionCount === 97 &&
      Array.isArray(manifest.migrations) &&
      manifest.migrations.length === 97 &&
      new Set(manifest.migrations.map((row) => row.version)).size === 97 &&
      same(
        manifest.migrations.map((row) => row.version),
        manifest.migrations.map((row) => row.version).sort(),
      ) &&
      manifest.migrations.every(
        (row) =>
          /^\d{14}$/u.test(row.version) && safeReference({ path: row.path, sha256: row.sha256 }),
      ),
    "prestate_manifest_invalid",
  );
  const excluded = manifest.migrations.filter(
    (row) => row.version === CONNECTOR_SQL.remote[0].version,
  );
  requireValue(
    excluded.length === 1 && excluded[0].sha256 === CONNECTOR_SQL.remote[0].sha256,
    "prestate_manifest_mapping",
  );
  const seed = manifest.migrations.filter((row) => row.version !== CONNECTOR_SQL.remote[0].version);
  const expected = seed.map(({ version, sha256 }) => ({ version, sha256 }));
  requireValue(
    seed.every(
      (row) =>
        ![...CONNECTOR_SQL.source, ...CONNECTOR_SQL.laterWriters].some(
          (mapped) => mapped.version === row.version,
        ),
    ),
    "prestate_mapping_preapplied",
  );
  const ledger = readEvidence(inputs.ledger);
  actualReceipt(ledger, bundle, "connector-seed-ledger");
  requireValue(
    ledger.manifestSha256 === inputs.manifest.sha256 &&
      ledger.roleInventorySha256 === inputs.roles.sha256 &&
      ledger.prestateSha256 === prestate.snapshotSha256 &&
      Array.isArray(ledger.appliedMigrations) &&
      same(ledger.appliedMigrations, expected),
    "prestate_ledger_mismatch",
  );
  requireValue(
    Array.isArray(inputs.seedSql) &&
      inputs.seedSql.length === seed.length &&
      new Set(inputs.seedSql.map((row) => row.artifact?.path)).size === seed.length,
    "prestate_seed_inventory_incomplete",
  );
  for (const [index, row] of inputs.seedSql.entries()) {
    const pinned = seed[index];
    requireValue(
      exactKeys(row, ["version", "sourcePath", "artifact", "bytes"]) &&
        row.version === pinned.version &&
        row.sourcePath === pinned.path &&
        safeReference(row.artifact) &&
        row.artifact.sha256 === pinned.sha256 &&
        Number.isInteger(row.bytes) &&
        row.bytes > 0,
      "prestate_seed_binding",
    );
    const bytes = readBytes(row.artifact);
    requireValue(
      Buffer.isBuffer(bytes) && bytes.length === row.bytes && sha(bytes) === pinned.sha256,
      "prestate_seed_bytes_mismatch",
    );
  }
  const roles = readEvidence(inputs.roles);
  actualReceipt(roles, bundle, "connector-role-inventory");
  requireValue(
    roles.prestateSha256 === prestate.snapshotSha256 &&
      roles.manifestSha256 === inputs.manifest.sha256 &&
      Array.isArray(roles.roles) &&
      roles.roles.length >= ROLES.length &&
      roles.roles.length <= 256 &&
      new Set(roles.roles.map((row) => row.role)).size === roles.roles.length &&
      roles.roles.every(
        (row) =>
          exactKeys(row, [
            "role",
            "superuser",
            "bypassRls",
            "inherit",
            "canLogin",
            "createRole",
            "createDb",
            "replication",
          ]) &&
          typeof row.role === "string" &&
          row.role.length > 0 &&
          row.role !== "public" &&
          Object.entries(row).every(([key, flag]) => key === "role" || typeof flag === "boolean"),
      ) &&
      ROLES.every((role) => roles.roles.some((row) => row.role === role)),
    "role_inventory_incomplete",
  );
  const names = roles.roles.map((row) => row.role).sort();
  const expectedPairs = [...names, "public"]
    .sort()
    .flatMap((policyRole) => names.map((apiRole) => `${policyRole}:${apiRole}`))
    .sort();
  requireValue(
    Array.isArray(roles.memberships) &&
      same(
        roles.memberships.map((row) => `${row.policyRole}:${row.apiRole}`).sort(),
        expectedPairs,
      ) &&
      roles.memberships.every(
        (row) =>
          exactKeys(row, ["policyRole", "apiRole", "member", "inherits"]) &&
          typeof row.member === "boolean" &&
          typeof row.inherits === "boolean" &&
          ((row.policyRole !== "public" && row.policyRole !== row.apiRole) ||
            (row.member && row.inherits)),
      ),
    "role_membership_incomplete",
  );
  const digest = sha(JSON.stringify(inputs));
  requireValue(prestate.inputsSha256 === digest, "prestate_inputs_digest_mismatch");
  return { digest, roles };
}

function validatePolicyMembership(policy, roles) {
  requireValue(
    Array.isArray(policy.roles) &&
      policy.roles.length > 0 &&
      policy.roles.every((role) => typeof role === "string" && role.length > 0) &&
      new Set(policy.roles).size === policy.roles.length &&
      Array.isArray(policy.apiRoleMembership),
    "policy_membership_incomplete",
  );
  const pairs = policy.roles
    .flatMap((policyRole) => ROLES.map((apiRole) => `${policyRole}:${apiRole}`))
    .sort();
  requireValue(
    same(policy.apiRoleMembership.map((row) => `${row.policyRole}:${row.apiRole}`).sort(), pairs) &&
      policy.apiRoleMembership.every(
        (row) =>
          exactKeys(row, ["policyRole", "apiRole", "member", "inherits"]) &&
          typeof row.member === "boolean" &&
          typeof row.inherits === "boolean",
      ),
    "policy_membership_incomplete",
  );
  if (roles)
    for (const row of policy.apiRoleMembership) {
      const frozen = roles.memberships.find(
        (member) => member.policyRole === row.policyRole && member.apiRole === row.apiRole,
      );
      requireValue(
        frozen && frozen.member === row.member && frozen.inherits === row.inherits,
        "policy_membership_mismatch",
      );
    }
}

function bindSnapshotRoles(snapshot, roles) {
  const names = new Set(roles.roles.map((row) => row.role));
  requireValue(
    [...snapshot.categories.schema, ...snapshot.categories.function].every((row) =>
      names.has(row.detail.owner),
    ),
    "snapshot_role_owner_missing",
  );
  for (const row of snapshot.categories.rls) {
    for (const role of row.detail.apiRoleAttributes) {
      const frozen = roles.roles.find((item) => item.role === role.role);
      requireValue(
        frozen && frozen.superuser === role.superuser && frozen.bypassRls === role.bypassRls,
        "snapshot_role_attributes_mismatch",
      );
    }
    for (const policy of row.detail.policies) validatePolicyMembership(policy, roles);
  }
}
function validateSnapshot(snapshot) {
  requireValue(
    snapshot?.scope?.proofId === CONNECTOR_PROOF_ID && scoped(snapshot.scope.objects),
    "capture_scope_mismatch",
  );
  for (const category of ["schema", "acl", "rls"]) {
    const rows = snapshot.categories?.[category];
    requireValue(
      Array.isArray(rows) &&
        scoped(rows.map((row) => row.object_id)) &&
        rows.every((row) => exactKeys(row, ["object_id", "detail"]) && record(row.detail)),
      "capture_category_incomplete",
    );
  }
  for (const [index, schema] of snapshot.categories.schema.entries()) {
    const acl = snapshot.categories.acl[index].detail;
    const rls = snapshot.categories.rls[index].detail;
    requireValue(
      exactKeys(schema.detail, [
        "kind",
        "owner",
        "columns",
        "indexes",
        "sequence",
        "triggers",
        "constraints",
        "persistence",
        "publications",
        "rewriteRules",
        "viewDefinition",
        "relationOptions",
        "replicaIdentity",
        "internalTriggers",
        "materializedViewPopulated",
      ]) &&
        Array.isArray(schema.detail.columns) &&
        schema.detail.columns.length > 0 &&
        Array.isArray(schema.detail.constraints) &&
        Array.isArray(schema.detail.indexes) &&
        Array.isArray(schema.detail.triggers) &&
        Array.isArray(schema.detail.internalTriggers) &&
        Array.isArray(schema.detail.publications) &&
        Array.isArray(schema.detail.rewriteRules),
      "schema_detail_incomplete",
    );
    requireValue(
      new Set(schema.detail.columns.map((column) => column.name)).size ===
        schema.detail.columns.length &&
        schema.detail.columns.every(
          (column) =>
            exactKeys(column, [
              "name",
              "type",
              "nullable",
              "default",
              "identity",
              "generated",
              "collation",
            ]) &&
            typeof column.name === "string" &&
            column.name.length > 0 &&
            typeof column.type === "string" &&
            typeof column.nullable === "boolean",
        ),
      "column_definition_incomplete",
    );
    requireValue(
      exactKeys(acl, ["columnAcl", "roleMatrix", "explicitAcl"]) &&
        (acl.explicitAcl === null || typeof acl.explicitAcl === "string"),
      "privilege_detail_incomplete",
    );
    requireValue(
      Array.isArray(acl.roleMatrix) &&
        same(
          acl.roleMatrix.map((row) => row.role),
          ROLES,
        ) &&
        Array.isArray(acl.columnAcl) &&
        same(
          acl.columnAcl.map((row) => row.name),
          schema.detail.columns.map((row) => row.name),
        ),
      "privilege_detail_incomplete",
    );
    for (const role of acl.roleMatrix)
      for (const key of [
        "select",
        "insert",
        "update",
        "delete",
        "truncate",
        "references",
        "trigger",
        "maintain",
      ])
        requireValue(typeof role[key] === "boolean", "table_privilege_missing");
    for (const column of acl.columnAcl)
      for (const role of ["anon", "authenticated", "service"])
        for (const privilege of ["Select", "Insert", "Update", "References"])
          requireValue(
            typeof column[`${role}${privilege}`] === "boolean",
            "column_privilege_missing",
          );
    requireValue(
      exactKeys(rls, ["enabled", "forced", "policies", "apiRoleAttributes"]) &&
        typeof rls.enabled === "boolean" &&
        typeof rls.forced === "boolean" &&
        Array.isArray(rls.policies) &&
        Array.isArray(rls.apiRoleAttributes) &&
        same(
          rls.apiRoleAttributes.map((role) => role.role),
          ROLES,
        ) &&
        rls.apiRoleAttributes.every(
          (role) => typeof role.bypassRls === "boolean" && typeof role.superuser === "boolean",
        ),
      "policy_detail_incomplete",
    );
    requireValue(
      new Set(rls.policies.map((policy) => policy.name)).size === rls.policies.length,
      "policy_detail_incomplete",
    );
    for (const policy of rls.policies) {
      requireValue(
        typeof policy.name === "string" &&
          typeof policy.permissive === "boolean" &&
          Array.isArray(policy.roles) &&
          typeof policy.command === "string" &&
          ["using", "check"].every(
            (key) => policy[key] === null || typeof policy[key] === "string",
          ) &&
          Array.isArray(policy.apiRoleMembership),
        "policy_detail_incomplete",
      );
      validatePolicyMembership(policy);
    }
  }
  const functions = snapshot.categories.function;
  requireValue(
    Array.isArray(functions) &&
      functions.length >= 2 &&
      functions.length <= 128 &&
      new Set(functions.map((row) => row.object_id)).size === functions.length &&
      ["auth.uid()", "public.touch_updated_at()"].every((name) =>
        functions.some((row) => row.object_id === name),
      ),
    "dependency_capture_incomplete",
  );
  for (const row of functions)
    requireValue(
      exactKeys(row.detail, [
        "owner",
        "securityDefiner",
        "definitionSha256",
        "effectivePrivileges",
        "result",
        "volatility",
        "searchPath",
        "settings",
        "otherSettingCount",
        "explicitAcl",
      ]) &&
        SHA.test(row.detail.definitionSha256) &&
        typeof row.detail.securityDefiner === "boolean" &&
        typeof row.detail.owner === "string" &&
        row.detail.owner.length > 0 &&
        typeof row.detail.result === "string" &&
        row.detail.result.length > 0 &&
        ["i", "s", "v"].includes(row.detail.volatility) &&
        (row.detail.explicitAcl === null || typeof row.detail.explicitAcl === "string") &&
        Array.isArray(row.detail.searchPath) &&
        Array.isArray(row.detail.settings) &&
        row.detail.settings.every(
          (setting) => typeof setting === "string" && /^[a-z_][a-z0-9_.]*=/u.test(setting),
        ) &&
        new Set(row.detail.settings.map((setting) => setting.split("=", 1)[0])).size ===
          row.detail.settings.length &&
        same(
          row.detail.searchPath,
          row.detail.settings.filter((setting) => setting.startsWith("search_path=")),
        ) &&
        row.detail.otherSettingCount ===
          row.detail.settings.length - row.detail.searchPath.length &&
        Array.isArray(row.detail.effectivePrivileges) &&
        same(
          row.detail.effectivePrivileges.map((item) => item.role),
          ROLES,
        ) &&
        row.detail.effectivePrivileges.every(
          (item) => typeof item.execute === "boolean" && typeof item.schemaUsage === "boolean",
        ),
      "dependency_detail_incomplete",
    );
  return {
    digest: digestMigrationSchemaSnapshot(snapshot),
    fingerprint: fingerprintMigrationSchemaSnapshot(snapshot),
  };
}

function validateDependencyClosure(value, artifacts, before, inputs, readEvidence) {
  const ref = artifacts.compatibility.dependencyClosure;
  requireValue(safeReference(ref), "dependency_closure_reference_required");
  const closure = readEvidence(ref);
  actualReceipt(closure, value, "connector-dependency-closure");
  requireValue(
    closure.prestateInputsSha256 === inputs.digest &&
      closure.prestateSha256 === before.digest &&
      closure.roleInventorySha256 === artifacts.commonPrestate.inputs.roles.sha256 &&
      closure.remoteCaptureSha256 === value.artifacts.remoteCapture.sha256 &&
      closure.sourceCaptureSha256 === value.artifacts.sourceCapture.sha256 &&
      exactKeys(closure.snapshots, ["prestate", "remote", "source"]),
    "dependency_closure_binding",
  );
  for (const branch of ["prestate", "remote", "source"]) {
    const snapshot = (
      branch === "prestate" ? artifacts.commonPrestate : artifacts[`${branch}Capture`]
    ).snapshot;
    const inventory = closure.snapshots[branch];
    const routines = snapshot.categories.function.map((row) => row.object_id).sort();
    requireValue(
      inventory?.snapshotSha256 === digestMigrationSchemaSnapshot(snapshot) &&
        Array.isArray(inventory.relations) &&
        scoped(inventory.relations.map((row) => row.object_id)) &&
        Array.isArray(inventory.routines) &&
        same(inventory.routines.map((row) => row.object_id).sort(), routines),
      "dependency_closure_incomplete",
    );
    for (const [index, row] of inventory.relations.entries()) {
      const details = Object.fromEntries(
        ["schema", "acl", "rls"].map((category) => [
          category,
          snapshot.categories[category][index].detail,
        ]),
      );
      requireValue(
        row.detailSha256 === sha(JSON.stringify(details)) && safeReference(row.observation),
        "dependency_relation_binding",
      );
      const observation = readEvidence(row.observation);
      actualReceipt(observation, value, "connector-dependency-observation");
      requireValue(
        observation.objectId === row.object_id &&
          observation.snapshotSha256 === inventory.snapshotSha256 &&
          observation.prestateInputsSha256 === inputs.digest &&
          observation.detailSha256 === row.detailSha256 &&
          same(observation.scannedCategories, ["schema", "acl", "rls"]) &&
          observation.policyAndTriggerBodiesReviewed === true &&
          observation.unresolvedReferences === 0 &&
          Array.isArray(observation.functionDependencies) &&
          new Set(observation.functionDependencies).size ===
            observation.functionDependencies.length &&
          observation.functionDependencies.every((id) => routines.includes(id)),
        "dependency_observation_incomplete",
      );
    }
    for (const row of inventory.routines) {
      const detail = snapshot.categories.function.find(
        (routine) => routine.object_id === row.object_id,
      ).detail;
      requireValue(
        row.detailSha256 === sha(JSON.stringify(detail)) && safeReference(row.observation),
        "dependency_helper_binding",
      );
      const observation = readEvidence(row.observation);
      actualReceipt(observation, value, "connector-dependency-observation");
      requireValue(
        observation.objectId === row.object_id &&
          observation.snapshotSha256 === inventory.snapshotSha256 &&
          observation.prestateInputsSha256 === inputs.digest &&
          observation.detailSha256 === row.detailSha256 &&
          observation.scannedDefinitionSha256 === detail.definitionSha256 &&
          observation.definitionAndSettingsReviewed === true &&
          observation.dynamicReferencesReviewed === true &&
          observation.unresolvedReferences === 0 &&
          Array.isArray(observation.functionDependencies) &&
          new Set(observation.functionDependencies).size ===
            observation.functionDependencies.length &&
          observation.functionDependencies.every((id) => routines.includes(id)) &&
          Array.isArray(observation.schemaDependencies) &&
          observation.schemaDependencies.length > 0 &&
          observation.schemaDependencies.every(
            (schema) => typeof schema === "string" && schema.length > 0,
          ) &&
          observation.schemaDependencies.includes(row.object_id.split(".")[0]) &&
          observation.schemaUsageAndExecuteVerified === true,
        "dependency_observation_incomplete",
      );
    }
  }
}

/** Pure receipt-shape checks. This deliberately cannot authenticate or accept a proof. */
export function inspectConnectorRuntimeEvidence(
  value,
  artifacts,
  {
    readEvidence = () => {
      throw new Error("connector_proof_evidence_reader_required");
    },
    readBytes = () => {
      throw new Error("connector_proof_seed_reader_required");
    },
  } = {},
) {
  validateConnectorMappingContract(value);
  const prestate = artifacts.commonPrestate;
  actualReceipt(prestate, value, "connector-common-prestate");
  requireValue(
    prestate.postgresVersionNum >= 170000 &&
      prestate.postgresVersionNum < 180000 &&
      SHA.test(prestate.containerId ?? "") &&
      /^sha256:[a-f0-9]{64}$/u.test(prestate.imageDigest ?? ""),
    "runtime_identity_invalid",
  );
  requireValue(
    prestate.networkInternal === true &&
      prestate.publishedPorts === 0 &&
      prestate.productionReachable === false &&
      prestate.protectedRecoveryBaselineUnchanged === true,
    "isolation_unproven",
  );
  const before = validateSnapshot(prestate.snapshot);
  requireValue(before.digest === prestate.snapshotSha256, "prestate_digest_mismatch");
  const inputs = validatePrestateInputs(prestate, value, readEvidence, readBytes);
  bindSnapshotRoles(prestate.snapshot, inputs.roles);
  const branchResults = {};
  for (const branch of ["remote", "source"]) {
    const execution = artifacts[`${branch}Execution`];
    const capture = artifacts[`${branch}Capture`];
    actualReceipt(execution, value, "connector-mapping-execution");
    actualReceipt(capture, value, "connector-mapping-capture");
    requireValue(
      execution.branch === branch &&
        capture.branch === branch &&
        execution.exitCode === 0 &&
        execution.sqlExecuted === true &&
        typeof execution.executor === "string" &&
        execution.executor.length > 0 &&
        same(execution.sqlInputs, CONNECTOR_SQL[branch]),
      "sql_execution_binding",
    );
    requireValue(
      execution.statementTimeoutMs === 10000 &&
        execution.lockTimeoutMs === 1000 &&
        execution.idleTransactionTimeoutMs === 15000 &&
        Number.isInteger(execution.clientTimeoutMs) &&
        execution.clientTimeoutMs > 0 &&
        execution.clientTimeoutMs <= 120000,
      "execution_limits_invalid",
    );
    requireValue(
      execution.prestateSha256 === before.digest &&
        capture.prestateSha256 === before.digest &&
        execution.prestateInputsSha256 === inputs.digest &&
        capture.prestateInputsSha256 === inputs.digest &&
        execution.containerId === prestate.containerId &&
        capture.containerId === prestate.containerId &&
        execution.postgresVersionNum === prestate.postgresVersionNum &&
        capture.postgresVersionNum === prestate.postgresVersionNum,
      "branch_prestate_mismatch",
    );
    requireValue(
      execution.databaseName ===
        `kova_connector_proof_${value.attemptId.replaceAll("-", "").slice(0, 12)}_${branch}` &&
        capture.databaseName === execution.databaseName,
      "isolated_database_invalid",
    );
    requireValue(
      execution.captureSha256 === value.artifacts[`${branch}Capture`].sha256 &&
        capture.collectorQuerySha256 === CONNECTOR_COLLECTOR_SHA256 &&
        execution.collectorQuerySha256 === CONNECTOR_COLLECTOR_SHA256 &&
        capture.readOnly === true &&
        capture.isolation === "repeatable read" &&
        capture.sessionReplicationRole === "origin" &&
        capture.statementTimeoutMs === 10000 &&
        capture.lockTimeoutMs === 1000,
      "capture_execution_binding",
    );
    requireValue(
      Date.parse(capture.startedAt) >= Date.parse(execution.startedAt) &&
        Date.parse(capture.completedAt) <= Date.parse(execution.completedAt),
      "capture_clock_mismatch",
    );
    branchResults[branch] = validateSnapshot(capture.snapshot);
    requireValue(
      branchResults[branch].digest === capture.snapshotSha256,
      "capture_digest_mismatch",
    );
  }
  requireValue(
    artifacts.remoteExecution.databaseName !== artifacts.sourceExecution.databaseName &&
      same(branchResults.remote.fingerprint, branchResults.source.fingerprint),
    "paired_fingerprint_mismatch",
  );
  for (const branch of ["remote", "source"])
    bindSnapshotRoles(artifacts[`${branch}Capture`].snapshot, inputs.roles);
  const compatibility = artifacts.compatibility;
  actualReceipt(compatibility, value, "connector-compatibility");
  requireValue(
    compatibility.remoteCaptureSha256 === value.artifacts.remoteCapture.sha256 &&
      compatibility.sourceCaptureSha256 === value.artifacts.sourceCapture.sha256 &&
      same(compatibility.laterWriterInputs, CONNECTOR_SQL.laterWriters),
    "compatibility_binding",
  );
  requireValue(
    Array.isArray(compatibility.checks) &&
      same(
        compatibility.checks.map((row) => row.id).sort(),
        [...CONNECTOR_REQUIRED_CHECKS].sort(),
      ) &&
      compatibility.checks.every(
        (row) =>
          row.status === "PASS" &&
          row.executionMode === "ACTUAL_ISOLATED_LOCAL" &&
          safeReference(row.observation),
      ),
    "compatibility_checks_incomplete",
  );
  for (const check of compatibility.checks) {
    const observation = readEvidence(check.observation);
    actualReceipt(observation, value, "connector-check-observation");
    requireValue(
      observation.checkId === check.id &&
        observation.remoteCaptureSha256 === value.artifacts.remoteCapture.sha256 &&
        observation.sourceCaptureSha256 === value.artifacts.sourceCapture.sha256 &&
        Number.isInteger(observation.assertionsExecuted) &&
        observation.assertionsExecuted > 0 &&
        observation.assertionsFailed === 0,
      "compatibility_observation_invalid",
    );
  }
  requireValue(
    compatibility.dependencyClosureComplete === true &&
      compatibility.nonConnectorEffectsComplete === true &&
      compatibility.unresolvedNonConnectorEffects === 0 &&
      same(
        compatibility.reviewedSourceVersions,
        CONNECTOR_SQL.source.map((row) => row.version),
      ) &&
      compatibility.historicalPopulatedEvidenceSubstituted === false,
    "dependency_or_later_writer_gap",
  );
  validateDependencyClosure(value, artifacts, before, inputs, readEvidence);
  requireValue(
    Array.isArray(compatibility.historicalRequirements) &&
      same(compatibility.historicalRequirements.map((row) => row.id).sort(), [
        "endpoint-remote-content",
        "endpoint-source-content",
        "later-writer-history-disposition",
        "mapping-effect-lineage",
      ]) &&
      compatibility.historicalRequirements.every(
        (row) => row.disposition === "SATISFIED_WITH_BOUND_EVIDENCE" && safeReference(row.evidence),
      ),
    "historical_evidence_gap",
  );
  for (const requirement of compatibility.historicalRequirements)
    readEvidence(requirement.evidence);
  const rollback = artifacts.rollback;
  actualReceipt(rollback, value, "connector-rollback-cleanup");
  requireValue(
    rollback.prestateSha256 === before.digest &&
      rollback.remoteRestoredSnapshotSha256 === before.digest &&
      rollback.sourceRestoredSnapshotSha256 === before.digest &&
      rollback.disposableDatabasesRemoved === true &&
      rollback.protectedRecoveryBaselineUnchanged === true &&
      same(rollback.databaseNames, [
        artifacts.remoteExecution.databaseName,
        artifacts.sourceExecution.databaseName,
      ]),
    "rollback_or_cleanup_incomplete",
  );
  const review = artifacts.independentReview;
  requireValue(
    review.schemaVersion === 1 &&
      review.kind === "connector-independent-review" &&
      review.proofId === CONNECTOR_PROOF_ID &&
      review.attemptId === value.attemptId &&
      review.decision === "PASS" &&
      review.independent === true &&
      typeof review.reviewer === "string" &&
      review.reviewer.length > 0 &&
      review.reviewer !== artifacts.sourceExecution.executor &&
      review.reviewer !== artifacts.remoteExecution.executor,
    "independent_review_invalid",
  );
  requireValue(
    review.subjectSha256 === connectorReviewSubjectSha256(value) &&
      review.existingV2Unchanged === true &&
      review.originalPinsUnchanged === true &&
      review.completeScope === true &&
      review.noHistoricalEvidenceSubstitution === true &&
      review.unresolvedFindings === 0 &&
      timestamp(review.reviewedAt) &&
      Date.parse(review.reviewedAt) >= Date.parse(rollback.completedAt),
    "independent_review_incomplete",
  );
  return {
    status: "RUNTIME_STRUCTURE_VALID_NOT_AUTHENTICATED",
    schemaProofAccepted: false,
    proofId: CONNECTOR_PROOF_ID,
  };
}

/** Caller must supply the separately trusted independent-review digest. No cloud/DB calls. */
export function verifyConnectorMappingProof(value, { artifactRoot, independentReviewSha256 } = {}) {
  validateConnectorMappingContract(value);
  requireValue(
    typeof artifactRoot === "string" && isAbsolute(artifactRoot),
    "artifact_root_required",
  );
  requireValue(
    SHA.test(independentReviewSha256 ?? "") &&
      independentReviewSha256 === value.artifacts.independentReview.sha256,
    "independent_review_authority_required",
  );
  const artifacts = Object.fromEntries(
    CONNECTOR_ARTIFACT_KEYS.map((key) => [
      key,
      readConnectorArtifact(artifactRoot, value.artifacts[key]),
    ]),
  );
  validateHistoricalArtifacts(artifacts);
  inspectConnectorRuntimeEvidence(value, artifacts, {
    readEvidence: (ref) => readConnectorArtifact(artifactRoot, ref),
    readBytes: (ref) => readConnectorArtifactBytes(artifactRoot, ref),
  });
  return {
    status: "CONNECTOR_METHOD_VERIFIED",
    proofId: CONNECTOR_PROOF_ID,
    method: CONNECTOR_METHOD,
    schemaProofAccepted: true,
    acceptedProofDelta: 1,
    lineageAutomaticallyModified: false,
    existingV2Unchanged: true,
    productionOperations: 0,
    incrementalSpendUsd: 0,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 4 && process.argv[2] === "--verify", "usage_invalid");
    const bytes = readFileSync(process.argv[3]);
    requireValue(bytes.length > 0 && bytes.length <= MAX_BYTES, "bundle_size_invalid");
    const result = verifyConnectorMappingProof(JSON.parse(bytes.toString("utf8")), {
      artifactRoot: process.env.KOVA_CONNECTOR_PROOF_ARTIFACT_ROOT,
      independentReviewSha256: process.env.KOVA_CONNECTOR_INDEPENDENT_REVIEW_SHA256,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = /^connector_proof_[a-z_]+$/u.test(error.message)
      ? error.message
      : "connector_proof_validation_failed";
    process.stderr.write(`${JSON.stringify({ status: "NOT_ACCEPTED", code })}\n`);
    process.exitCode = 1;
  }
}
