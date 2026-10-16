import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONNECTOR_AMENDMENT_SHA256,
  CONNECTOR_ARTIFACT_KEYS,
  CONNECTOR_COLLECTOR_SHA256,
  CONNECTOR_HISTORICAL_ARTIFACTS,
  CONNECTOR_METHOD,
  CONNECTOR_PRESTATE_MANIFEST_SHA256,
  CONNECTOR_PROOF_ID,
  CONNECTOR_RELATIONS,
  CONNECTOR_REQUIRED_CHECKS,
  CONNECTOR_SOURCE,
  CONNECTOR_SQL,
  connectorReviewSubjectSha256,
  readConnectorArtifact,
  readConnectorArtifactBytes,
  inspectConnectorRuntimeEvidence,
  validateConnectorMappingContract,
  verifyConnectorMappingProof,
} from "../../scripts/release/connector-mapping-proof.mjs";
import { digestMigrationSchemaSnapshot } from "../../scripts/release/migration-schema-fingerprint.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
// Public source bytes are inspected, never executed. All execution-shaped
// receipts below remain synthetic and are never passed to accepting verification.
const manifestBytes = readFileSync(
  new URL("../fixtures/production-migration-history-20260904/manifest.json", import.meta.url),
);
const seedManifest = JSON.parse(manifestBytes);
const publicSeedBytes = Object.fromEntries(
  seedManifest.migrations.map((row) => [
    row.path,
    readFileSync(new URL(`../../${row.path}`, import.meta.url)),
  ]),
);

// These are synthetic packet/file fixtures only. They contain no production
// catalog, actual execution receipts, credentials or accepted schema evidence.
function packet() {
  return {
    schemaVersion: 3,
    method: CONNECTOR_METHOD,
    proofId: CONNECTOR_PROOF_ID,
    amendmentSha256: CONNECTOR_AMENDMENT_SHA256,
    attemptId: "00000000-0000-4000-8000-000000000001",
    scope: [...CONNECTOR_RELATIONS],
    source: { ...CONNECTOR_SOURCE },
    remoteLedgerCount: 98,
    artifacts: Object.fromEntries(
      CONNECTOR_ARTIFACT_KEYS.map((key) => [
        key,
        {
          path: `${key}.json`,
          sha256: CONNECTOR_HISTORICAL_ARTIFACTS[key] ?? hash(`synthetic:${key}`),
        },
      ]),
    ),
  };
}

test("connector method packet validation never counts synthetic preparation as acceptance", () => {
  assert.deepEqual(validateConnectorMappingContract(packet()), {
    status: "CONTRACT_VALID_NOT_EXECUTED",
    schemaProofAccepted: false,
    proofId: CONNECTOR_PROOF_ID,
  });
});

test("exported approved SQL bindings cannot be mutated in process", () => {
  for (const entries of Object.values(CONNECTOR_SQL)) {
    for (const entry of entries) {
      assert.throws(() => {
        entry.sha256 = "0".repeat(64);
      }, TypeError);
    }
  }
});

for (const [name, mutation, code] of [
  [
    "legacy v2 packet",
    (value) => {
      value.schemaVersion = 2;
    },
    "method_invalid",
  ],
  [
    "different mapping",
    (value) => {
      value.proofId = "proof-20260823215848";
    },
    "method_invalid",
  ],
  [
    "unapproved amendment",
    (value) => {
      value.amendmentSha256 = "1".repeat(64);
    },
    "amendment_mismatch",
  ],
  [
    "missing relation",
    (value) => {
      value.scope.pop();
    },
    "scope_mismatch",
  ],
  [
    "extra relation",
    (value) => {
      value.scope.push("public.unrelated");
    },
    "scope_mismatch",
  ],
  [
    "duplicated relation",
    (value) => {
      value.scope[0] = value.scope[1];
    },
    "scope_mismatch",
  ],
  [
    "reordered scope",
    (value) => {
      value.scope.reverse();
    },
    "scope_mismatch",
  ],
  [
    "changed source commit",
    (value) => {
      value.source.commit = "1".repeat(40);
    },
    "historical_pin_mismatch",
  ],
  [
    "source ledger substitution",
    (value) => {
      value.source.ledgerCount = 156;
    },
    "historical_pin_mismatch",
  ],
  [
    "remote ledger substitution",
    (value) => {
      value.remoteLedgerCount = 97;
    },
    "historical_pin_mismatch",
  ],
  [
    "historical content substitution",
    (value) => {
      value.artifacts.historicalSource.sha256 = "2".repeat(64);
    },
    "historical_artifact_mismatch",
  ],
  [
    "missing rollback",
    (value) => {
      delete value.artifacts.rollback;
    },
    "artifact_inventory_invalid",
  ],
  [
    "missing independent review",
    (value) => {
      delete value.artifacts.independentReview;
    },
    "artifact_inventory_invalid",
  ],
  [
    "unreviewed extra artifact",
    (value) => {
      value.artifacts.other = { path: "other.json", sha256: "3".repeat(64) };
    },
    "artifact_inventory_invalid",
  ],
  [
    "artifact alias",
    (value) => {
      value.artifacts.rollback.path = value.artifacts.commonPrestate.path;
    },
    "artifact_alias",
  ],
  [
    "absolute path",
    (value) => {
      value.artifacts.rollback.path = "/private/rollback.json";
    },
    "artifact_reference_invalid",
  ],
  [
    "parent traversal",
    (value) => {
      value.artifacts.rollback.path = "../rollback.json";
    },
    "artifact_reference_invalid",
  ],
  [
    "encoded platform separator",
    (value) => {
      value.artifacts.rollback.path = "private\\rollback.json";
    },
    "artifact_reference_invalid",
  ],
  [
    "unexpected acceptance claim",
    (value) => {
      value.accepted = true;
    },
    "contract_invalid",
  ],
]) {
  test(`connector packet rejects ${name}`, () => {
    const value = packet();
    mutation(value);
    assert.throws(
      () => validateConnectorMappingContract(value),
      new RegExp(`^Error: connector_proof_${code}$`, "u"),
    );
  });
}

test("independent review subject binds every non-review artifact and all scope pins", () => {
  const first = packet();
  const initial = connectorReviewSubjectSha256(first);
  first.artifacts.compatibility.sha256 = "4".repeat(64);
  assert.notEqual(connectorReviewSubjectSha256(first), initial);
  const reviewChanged = packet();
  reviewChanged.artifacts.independentReview.sha256 = "5".repeat(64);
  assert.equal(connectorReviewSubjectSha256(reviewChanged), initial);
  reviewChanged.artifacts.sourceCapture.sha256 = "6".repeat(64);
  assert.notEqual(connectorReviewSubjectSha256(reviewChanged), initial);
});

test("execution verification requires separately trusted review authority", () => {
  assert.throws(
    () => verifyConnectorMappingProof(packet(), { artifactRoot: tmpdir() }),
    /connector_proof_independent_review_authority_required/u,
  );
  assert.throws(
    () =>
      verifyConnectorMappingProof(packet(), {
        artifactRoot: tmpdir(),
        independentReviewSha256: "0".repeat(64),
      }),
    /connector_proof_independent_review_authority_required/u,
  );
});

test("prepared packet cannot pass without actual hash-bound receipt files", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-connector-packet-test-"));
  try {
    const value = packet();
    assert.throws(
      () =>
        verifyConnectorMappingProof(value, {
          artifactRoot: directory,
          independentReviewSha256: value.artifacts.independentReview.sha256,
        }),
      /connector_proof_artifact_unavailable/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("file binding hashes actual bytes and rejects changed content", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-connector-file-test-"));
  try {
    const bytes = '{"synthetic":true,"accepted":false}\n';
    const ref = { path: "fixture.json", sha256: hash(bytes) };
    writeFileSync(join(directory, ref.path), bytes, { mode: 0o600 });
    assert.deepEqual(readConnectorArtifact(directory, ref), { synthetic: true, accepted: false });
    writeFileSync(join(directory, ref.path), '{"synthetic":true,"accepted":true}\n');
    assert.throws(
      () => readConnectorArtifact(directory, ref),
      /connector_proof_artifact_hash_mismatch/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("artifact reader rejects symlinks without reading their target", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-connector-link-test-"));
  try {
    const bytes = '{"synthetic":true}\n';
    writeFileSync(join(directory, "actual.json"), bytes);
    symlinkSync(join(directory, "actual.json"), join(directory, "alias.json"));
    assert.throws(
      () => readConnectorArtifact(directory, { path: "alias.json", sha256: hash(bytes) }),
      /connector_proof_artifact_symlink/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("invalid JSON and oversized artifacts produce sanitized errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-connector-size-test-"));
  try {
    const malformed = "not json: private-looking-fixture-marker";
    writeFileSync(join(directory, "invalid.json"), malformed);
    assert.throws(
      () => readConnectorArtifact(directory, { path: "invalid.json", sha256: hash(malformed) }),
      /^Error: connector_proof_artifact_json_invalid$/u,
    );
    writeFileSync(join(directory, "large.json"), Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.throws(
      () => readConnectorArtifact(directory, { path: "large.json", sha256: "1".repeat(64) }),
      /^Error: connector_proof_artifact_size_invalid$/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

function syntheticRuntimeShapes() {
  const value = packet();
  const roles = ["anon", "authenticated", "service_role"];
  const schema = () => ({
    kind: "r",
    owner: "synthetic_owner",
    persistence: "p",
    replicaIdentity: "d",
    columns: [
      {
        name: "id",
        type: "uuid",
        nullable: false,
        default: null,
        identity: "",
        generated: "",
        collation: null,
      },
    ],
    constraints: [],
    indexes: [],
    triggers: [],
    internalTriggers: [],
    publications: [],
    rewriteRules: [],
    sequence: null,
    viewDefinition: null,
    relationOptions: null,
    materializedViewPopulated: null,
  });
  const column = { name: "id", acl: null };
  for (const role of ["anon", "authenticated", "service"])
    for (const privilege of ["Select", "Insert", "Update", "References"])
      column[`${role}${privilege}`] = false;
  const snapshot = {
    schemaVersion: 1,
    scope: { proofId: CONNECTOR_PROOF_ID, objects: [...CONNECTOR_RELATIONS] },
    categories: {
      schema: CONNECTOR_RELATIONS.map((object_id) => ({ object_id, detail: schema() })),
      acl: CONNECTOR_RELATIONS.map((object_id) => ({
        object_id,
        detail: {
          explicitAcl: null,
          columnAcl: [{ ...column }],
          roleMatrix: roles.map((role) => ({
            role,
            usage: null,
            select: false,
            insert: false,
            update: false,
            delete: false,
            truncate: false,
            references: false,
            trigger: false,
            maintain: false,
          })),
        },
      })),
      rls: CONNECTOR_RELATIONS.map((object_id) => ({
        object_id,
        detail: {
          enabled: true,
          forced: false,
          policies: [
            {
              name: "synthetic_owner_policy",
              command: "r",
              permissive: true,
              roles: ["authenticated"],
              using: "auth.uid() IS NOT NULL",
              check: null,
              apiRoleMembership: roles.map((apiRole) => ({
                policyRole: "authenticated",
                apiRole,
                member: apiRole === "authenticated",
                inherits: apiRole === "authenticated",
              })),
            },
          ],
          apiRoleAttributes: roles.map((role) => ({ role, superuser: false, bypassRls: false })),
        },
      })),
      function: ["auth.uid()", "public.touch_updated_at()"].map((object_id) => ({
        object_id,
        detail: {
          owner: "synthetic_owner",
          securityDefiner: false,
          definitionSha256: hash(object_id),
          result: "uuid",
          volatility: "s",
          explicitAcl: null,
          searchPath: ["search_path=pg_catalog, public, pg_temp"],
          settings: ["search_path=pg_catalog, public, pg_temp"],
          otherSettingCount: 0,
          effectivePrivileges: roles.map((role) => ({ role, execute: true, schemaUsage: true })),
        },
      })),
    },
  };
  const snapshotSha256 = digestMigrationSchemaSnapshot(snapshot);
  const receipt = (kind) => ({
    schemaVersion: 1,
    kind,
    executionMode: "ACTUAL_ISOLATED_LOCAL",
    attemptId: value.attemptId,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    status: "PASS",
    productionReads: 0,
    productionWrites: 0,
    incrementalSpendUsd: 0,
    sevenDotSqlExecuted: false,
  });
  const containerId = "a".repeat(64);
  const observations = {};
  const sqlBytes = {};
  const roleNames = [...roles, "synthetic_owner"].sort();
  observations["roles.json"] = {
    ...receipt("connector-role-inventory"),
    prestateSha256: snapshotSha256,
    manifestSha256: CONNECTOR_PRESTATE_MANIFEST_SHA256,
    roles: roleNames.map((role) => ({
      role,
      superuser: false,
      bypassRls: false,
      inherit: true,
      canLogin: false,
      createRole: false,
      createDb: false,
      replication: false,
    })),
    memberships: [...roleNames, "public"].sort().flatMap((policyRole) =>
      roleNames.map((apiRole) => ({
        policyRole,
        apiRole,
        member: policyRole === "public" || policyRole === apiRole,
        inherits: policyRole === "public" || policyRole === apiRole,
      })),
    ),
  };
  observations["manifest.json"] = structuredClone(seedManifest);
  const roleRef = { path: "roles.json", sha256: hash(JSON.stringify(observations["roles.json"])) };
  const seed = seedManifest.migrations.filter(
    (row) => row.version !== CONNECTOR_SQL.remote[0].version,
  );
  observations["ledger.json"] = {
    ...receipt("connector-seed-ledger"),
    prestateSha256: snapshotSha256,
    manifestSha256: CONNECTOR_PRESTATE_MANIFEST_SHA256,
    roleInventorySha256: roleRef.sha256,
    appliedMigrations: seed.map(({ version, sha256 }) => ({ version, sha256 })),
  };
  const inputs = {
    manifest: { path: "manifest.json", sha256: CONNECTOR_PRESTATE_MANIFEST_SHA256 },
    ledger: { path: "ledger.json", sha256: hash(JSON.stringify(observations["ledger.json"])) },
    roles: roleRef,
    seedSql: seed.map((row) => {
      const path = `seed/${row.version}.sql`;
      sqlBytes[path] = publicSeedBytes[row.path];
      return {
        version: row.version,
        sourcePath: row.path,
        artifact: { path, sha256: row.sha256 },
        bytes: sqlBytes[path].length,
      };
    }),
  };
  const inputsSha256 = hash(JSON.stringify(inputs));
  const artifacts = {
    commonPrestate: {
      ...receipt("connector-common-prestate"),
      postgresVersionNum: 170006,
      containerId,
      imageDigest: `sha256:${"b".repeat(64)}`,
      networkInternal: true,
      publishedPorts: 0,
      productionReachable: false,
      protectedRecoveryBaselineUnchanged: true,
      snapshot: structuredClone(snapshot),
      snapshotSha256,
      inputs,
      inputsSha256,
    },
  };
  for (const branch of ["remote", "source"]) {
    const databaseName = `kova_connector_proof_${value.attemptId.replaceAll("-", "").slice(0, 12)}_${branch}`;
    artifacts[`${branch}Execution`] = {
      ...receipt("connector-mapping-execution"),
      branch,
      containerId,
      postgresVersionNum: 170006,
      databaseName,
      executor: "synthetic_executor",
      exitCode: 0,
      sqlExecuted: true,
      collectorQuerySha256: CONNECTOR_COLLECTOR_SHA256,
      sqlInputs: structuredClone(CONNECTOR_SQL[branch]),
      prestateSha256: snapshotSha256,
      prestateInputsSha256: inputsSha256,
      captureSha256: value.artifacts[`${branch}Capture`].sha256,
      statementTimeoutMs: 10000,
      lockTimeoutMs: 1000,
      idleTransactionTimeoutMs: 15000,
      clientTimeoutMs: 120000,
    };
    artifacts[`${branch}Capture`] = {
      ...receipt("connector-mapping-capture"),
      branch,
      containerId,
      postgresVersionNum: 170006,
      databaseName,
      prestateSha256: snapshotSha256,
      prestateInputsSha256: inputsSha256,
      readOnly: true,
      collectorQuerySha256: CONNECTOR_COLLECTOR_SHA256,
      isolation: "repeatable read",
      sessionReplicationRole: "origin",
      statementTimeoutMs: 10000,
      lockTimeoutMs: 1000,
      snapshot: structuredClone(snapshot),
      snapshotSha256,
    };
  }
  artifacts.compatibility = {
    ...receipt("connector-compatibility"),
    remoteCaptureSha256: value.artifacts.remoteCapture.sha256,
    sourceCaptureSha256: value.artifacts.sourceCapture.sha256,
    laterWriterInputs: structuredClone(CONNECTOR_SQL.laterWriters),
    checks: CONNECTOR_REQUIRED_CHECKS.map((id) => {
      const path = `${id}.json`;
      observations[path] = {
        ...receipt("connector-check-observation"),
        checkId: id,
        remoteCaptureSha256: value.artifacts.remoteCapture.sha256,
        sourceCaptureSha256: value.artifacts.sourceCapture.sha256,
        assertionsExecuted: 1,
        assertionsFailed: 0,
      };
      return {
        id,
        status: "PASS",
        executionMode: "ACTUAL_ISOLATED_LOCAL",
        observation: { path, sha256: hash(JSON.stringify(observations[path])) },
      };
    }),
    dependencyClosureComplete: true,
    nonConnectorEffectsComplete: true,
    unresolvedNonConnectorEffects: 0,
    reviewedSourceVersions: CONNECTOR_SQL.source.map((row) => row.version),
    historicalPopulatedEvidenceSubstituted: false,
    historicalRequirements: [
      "endpoint-remote-content",
      "endpoint-source-content",
      "later-writer-history-disposition",
      "mapping-effect-lineage",
    ].map((id) => ({
      id,
      disposition: "SATISFIED_WITH_BOUND_EVIDENCE",
      evidence: { path: `${id}.json`, sha256: hash(id) },
    })),
  };
  for (const requirement of artifacts.compatibility.historicalRequirements)
    observations[requirement.evidence.path] = { syntheticFixture: true };
  const closure = {
    ...receipt("connector-dependency-closure"),
    prestateInputsSha256: inputsSha256,
    prestateSha256: snapshotSha256,
    roleInventorySha256: roleRef.sha256,
    remoteCaptureSha256: value.artifacts.remoteCapture.sha256,
    sourceCaptureSha256: value.artifacts.sourceCapture.sha256,
    snapshots: {},
  };
  for (const branch of ["prestate", "remote", "source"]) {
    const observationRef = (objectId, detail, extra) => {
      const path = `closure-${branch}-${hash(objectId)}.json`;
      observations[path] = {
        ...receipt("connector-dependency-observation"),
        objectId,
        snapshotSha256,
        prestateInputsSha256: inputsSha256,
        detailSha256: hash(JSON.stringify(detail)),
        unresolvedReferences: 0,
        functionDependencies: [],
        ...extra,
      };
      return { path, sha256: hash(JSON.stringify(observations[path])) };
    };
    closure.snapshots[branch] = {
      snapshotSha256,
      relations: CONNECTOR_RELATIONS.map((object_id, index) => {
        const details = Object.fromEntries(
          ["schema", "acl", "rls"].map((category) => [
            category,
            snapshot.categories[category][index].detail,
          ]),
        );
        return {
          object_id,
          detailSha256: hash(JSON.stringify(details)),
          observation: observationRef(object_id, details, {
            scannedCategories: ["schema", "acl", "rls"],
            policyAndTriggerBodiesReviewed: true,
            functionDependencies: ["auth.uid()"],
          }),
        };
      }),
      routines: snapshot.categories.function.map(({ object_id, detail }) => ({
        object_id,
        detailSha256: hash(JSON.stringify(detail)),
        observation: observationRef(object_id, detail, {
          scannedDefinitionSha256: detail.definitionSha256,
          definitionAndSettingsReviewed: true,
          dynamicReferencesReviewed: true,
          schemaDependencies: [object_id.split(".")[0]],
          schemaUsageAndExecuteVerified: true,
        }),
      })),
    };
  }
  observations["closure.json"] = closure;
  artifacts.compatibility.dependencyClosure = {
    path: "closure.json",
    sha256: hash(JSON.stringify(closure)),
  };
  artifacts.rollback = {
    ...receipt("connector-rollback-cleanup"),
    prestateSha256: snapshotSha256,
    remoteRestoredSnapshotSha256: snapshotSha256,
    sourceRestoredSnapshotSha256: snapshotSha256,
    disposableDatabasesRemoved: true,
    protectedRecoveryBaselineUnchanged: true,
    databaseNames: [artifacts.remoteExecution.databaseName, artifacts.sourceExecution.databaseName],
  };
  artifacts.independentReview = {
    schemaVersion: 1,
    kind: "connector-independent-review",
    proofId: CONNECTOR_PROOF_ID,
    attemptId: value.attemptId,
    decision: "PASS",
    independent: true,
    reviewer: "synthetic_other_reviewer",
    subjectSha256: connectorReviewSubjectSha256(value),
    existingV2Unchanged: true,
    originalPinsUnchanged: true,
    completeScope: true,
    noHistoricalEvidenceSubstitution: true,
    unresolvedFindings: 0,
    reviewedAt: "2026-01-01T00:00:02.000Z",
  };
  return {
    value,
    artifacts,
    observations,
    sqlBytes,
    readEvidence: (ref) => observations[ref.path],
    readBytes: (ref) => sqlBytes[ref.path],
  };
}

test("complete synthetic receipt shapes are inspected but cannot become accepted evidence", () => {
  const fixture = syntheticRuntimeShapes();
  assert.deepEqual(inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture), {
    status: "RUNTIME_STRUCTURE_VALID_NOT_AUTHENTICATED",
    schemaProofAccepted: false,
    proofId: CONNECTOR_PROOF_ID,
  });
});

for (const [name, mutate, code] of [
  [
    "prepared execution plan",
    (a) => {
      a.sourceExecution.executionMode = "PLAN";
    },
    "actual_execution_required",
  ],
  [
    "wrong PostgreSQL major",
    (a) => {
      a.commonPrestate.postgresVersionNum = 180003;
    },
    "runtime_identity_invalid",
  ],
  [
    "published port",
    (a) => {
      a.commonPrestate.publishedPorts = 1;
    },
    "isolation_unproven",
  ],
  [
    "production reachable",
    (a) => {
      a.commonPrestate.productionReachable = true;
    },
    "isolation_unproven",
  ],
  [
    "recovery baseline changed",
    (a) => {
      a.commonPrestate.protectedRecoveryBaselineUnchanged = false;
    },
    "isolation_unproven",
  ],
  [
    "production read",
    (a) => {
      a.sourceExecution.productionReads = 1;
    },
    "execution_scope_violation",
  ],
  [
    "paid execution",
    (a) => {
      a.sourceExecution.incrementalSpendUsd = 0.01;
    },
    "execution_scope_violation",
  ],
  [
    "unapproved DOT SQL",
    (a) => {
      a.sourceExecution.sevenDotSqlExecuted = true;
    },
    "execution_scope_violation",
  ],
  [
    "different attempt",
    (a) => {
      a.sourceExecution.attemptId = "00000000-0000-4000-8000-000000000002";
    },
    "actual_execution_required",
  ],
  [
    "cherry-picked SQL",
    (a) => {
      a.sourceExecution.sqlInputs.pop();
    },
    "sql_execution_binding",
  ],
  [
    "unexecuted SQL",
    (a) => {
      a.sourceExecution.sqlExecuted = false;
    },
    "sql_execution_binding",
  ],
  [
    "unbounded client",
    (a) => {
      a.sourceExecution.clientTimeoutMs = 0;
    },
    "execution_limits_invalid",
  ],
  [
    "different common prestate",
    (a) => {
      a.sourceExecution.prestateSha256 = "1".repeat(64);
    },
    "branch_prestate_mismatch",
  ],
  [
    "non-isolated database",
    (a) => {
      a.sourceExecution.databaseName = "postgres";
    },
    "isolated_database_invalid",
  ],
  [
    "changed capture binding",
    (a) => {
      a.sourceExecution.captureSha256 = "1".repeat(64);
    },
    "capture_execution_binding",
  ],
  [
    "different collector query",
    (a) => {
      a.sourceCapture.collectorQuerySha256 = "0".repeat(64);
    },
    "capture_execution_binding",
  ],
  [
    "different attempt database namespace",
    (a) => {
      a.sourceExecution.databaseName = "kova_connector_proof_ffffffffffff_source";
      a.sourceCapture.databaseName = a.sourceExecution.databaseName;
    },
    "isolated_database_invalid",
  ],
  [
    "capture outside execution clock",
    (a) => {
      a.sourceCapture.completedAt = "2026-01-01T00:00:03.000Z";
    },
    "capture_clock_mismatch",
  ],
  [
    "missing schema field",
    (a) => {
      delete a.sourceCapture.snapshot.categories.schema[0].detail.internalTriggers;
    },
    "schema_detail_incomplete",
  ],
  [
    "missing effective column permission",
    (a) => {
      delete a.sourceCapture.snapshot.categories.acl[0].detail.columnAcl[0].authenticatedUpdate;
    },
    "column_privilege_missing",
  ],
  [
    "missing role attributes",
    (a) => {
      a.sourceCapture.snapshot.categories.rls[0].detail.apiRoleAttributes.pop();
    },
    "policy_detail_incomplete",
  ],
  [
    "missing helper dependency",
    (a) => {
      a.sourceCapture.snapshot.categories.function.pop();
    },
    "dependency_capture_incomplete",
  ],
  [
    "missing compatibility check",
    (a) => {
      a.compatibility.checks.pop();
    },
    "compatibility_checks_incomplete",
  ],
  [
    "unresolved source side effect",
    (a) => {
      a.compatibility.unresolvedNonConnectorEffects = 1;
    },
    "dependency_or_later_writer_gap",
  ],
  [
    "synthetic historical substitution",
    (a) => {
      a.compatibility.historicalPopulatedEvidenceSubstituted = true;
    },
    "dependency_or_later_writer_gap",
  ],
  [
    "historical evidence gap",
    (a) => {
      a.compatibility.historicalRequirements[0].disposition = "MISSING";
    },
    "historical_evidence_gap",
  ],
  [
    "incomplete rollback",
    (a) => {
      a.rollback.sourceRestoredSnapshotSha256 = "0".repeat(64);
    },
    "rollback_or_cleanup_incomplete",
  ],
  [
    "unremoved test databases",
    (a) => {
      a.rollback.disposableDatabasesRemoved = false;
    },
    "rollback_or_cleanup_incomplete",
  ],
  [
    "self-review",
    (a) => {
      a.independentReview.reviewer = a.sourceExecution.executor;
    },
    "independent_review_invalid",
  ],
  [
    "review of another packet",
    (a) => {
      a.independentReview.subjectSha256 = "0".repeat(64);
    },
    "independent_review_incomplete",
  ],
  [
    "unresolved review finding",
    (a) => {
      a.independentReview.unresolvedFindings = 1;
    },
    "independent_review_incomplete",
  ],
]) {
  test(`runtime receipt checks reject ${name}`, () => {
    const fixture = syntheticRuntimeShapes();
    mutate(fixture.artifacts);
    assert.throws(
      () => inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture),
      new RegExp(`^Error: connector_proof_${code}$`, "u"),
    );
  });
}

test("rehashed but unequal full branch state is rejected", () => {
  const fixture = syntheticRuntimeShapes();
  fixture.artifacts.sourceCapture.snapshot.categories.schema[0].detail.owner =
    "different_synthetic_owner";
  fixture.artifacts.sourceCapture.snapshotSha256 = digestMigrationSchemaSnapshot(
    fixture.artifacts.sourceCapture.snapshot,
  );
  assert.throws(
    () => inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture),
    /connector_proof_paired_fingerprint_mismatch/u,
  );
});

test("compatibility observations must be read and tied to their exact check", () => {
  const fixture = syntheticRuntimeShapes();
  const first = fixture.artifacts.compatibility.checks[0];
  fixture.observations[first.observation.path].checkId = "other-synthetic-check";
  assert.throws(
    () => inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture),
    /connector_proof_compatibility_observation_invalid/u,
  );
});

test("prestate recipe binds the exact approved manifest bytes without executing SQL", () => {
  assert.equal(hash(manifestBytes), CONNECTOR_PRESTATE_MANIFEST_SHA256);
  const fixture = syntheticRuntimeShapes();
  assert.equal(fixture.artifacts.commonPrestate.inputs.seedSql.length, 96);
  assert.equal(
    inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture).schemaProofAccepted,
    false,
  );
});

test("seed byte reader verifies opaque SQL bytes and rejects tampering without execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "kova-connector-seed-test-"));
  try {
    const bytes = Buffer.from("-- nonexecuted synthetic SQL fixture\n");
    const ref = { path: "seed.sql", sha256: hash(bytes) };
    writeFileSync(join(directory, ref.path), bytes);
    assert.deepEqual(readConnectorArtifactBytes(directory, ref), bytes);
    writeFileSync(join(directory, ref.path), "-- changed\n");
    assert.throws(
      () => readConnectorArtifactBytes(directory, ref),
      /connector_proof_artifact_hash_mismatch/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

for (const [name, mutate, code] of [
  [
    "missing manifest",
    (f) => {
      delete f.artifacts.commonPrestate.inputs.manifest;
    },
    "prestate_manifest_binding",
  ],
  [
    "substituted manifest",
    (f) => {
      f.artifacts.commonPrestate.inputs.manifest.sha256 = "0".repeat(64);
    },
    "prestate_manifest_binding",
  ],
  [
    "reordered seed ledger",
    (f) => {
      f.observations["ledger.json"].appliedMigrations.reverse();
    },
    "prestate_ledger_mismatch",
  ],
  [
    "preapplied target mapping",
    (f) => {
      f.observations["ledger.json"].appliedMigrations.push({ ...CONNECTOR_SQL.remote[0] });
    },
    "prestate_ledger_mismatch",
  ],
  [
    "omitted seed SQL",
    (f) => {
      f.artifacts.commonPrestate.inputs.seedSql.pop();
    },
    "prestate_seed_inventory_incomplete",
  ],
  [
    "substituted seed SQL hash",
    (f) => {
      f.artifacts.commonPrestate.inputs.seedSql[0].artifact.sha256 = "0".repeat(64);
    },
    "prestate_seed_binding",
  ],
  [
    "changed seed SQL bytes",
    (f) => {
      const entry = f.artifacts.commonPrestate.inputs.seedSql[0];
      f.sqlBytes[entry.artifact.path] = Buffer.from("-- substituted SQL\n");
    },
    "prestate_seed_bytes_mismatch",
  ],
  [
    "missing role inventory",
    (f) => {
      delete f.artifacts.commonPrestate.inputs.roles;
    },
    "prestate_manifest_binding",
  ],
  [
    "role inventory bound to other prestate",
    (f) => {
      f.observations["roles.json"].prestateSha256 = "0".repeat(64);
    },
    "role_inventory_incomplete",
  ],
  [
    "missing role membership",
    (f) => {
      f.observations["roles.json"].memberships.pop();
    },
    "role_membership_incomplete",
  ],
  [
    "duplicate role membership",
    (f) => {
      const members = f.observations["roles.json"].memberships;
      members[0] = { ...members[1] };
    },
    "role_membership_incomplete",
  ],
  [
    "different branch frozen inputs",
    (f) => {
      f.artifacts.sourceExecution.prestateInputsSha256 = "0".repeat(64);
    },
    "branch_prestate_mismatch",
  ],
  [
    "different capture frozen inputs",
    (f) => {
      delete f.artifacts.remoteCapture.prestateInputsSha256;
    },
    "branch_prestate_mismatch",
  ],
  [
    "empty populated policy matrix",
    (f) => {
      f.artifacts.commonPrestate.snapshot.categories.rls[0].detail.policies[0].apiRoleMembership =
        [];
    },
    "policy_membership_incomplete",
  ],
  [
    "missing populated policy matrix",
    (f) => {
      delete f.artifacts.commonPrestate.snapshot.categories.rls[0].detail.policies[0]
        .apiRoleMembership;
    },
    "policy_detail_incomplete",
  ],
  [
    "duplicate populated policy matrix",
    (f) => {
      const matrix =
        f.artifacts.commonPrestate.snapshot.categories.rls[0].detail.policies[0].apiRoleMembership;
      matrix[0] = { ...matrix[1] };
    },
    "policy_membership_incomplete",
  ],
  [
    "mismatched frozen policy membership",
    (f) => {
      const membership = f.observations["roles.json"].memberships.find(
        (row) => row.policyRole === "authenticated" && row.apiRole === "anon",
      );
      membership.member = true;
    },
    "policy_membership_mismatch",
  ],
  [
    "missing helper search path",
    (f) => {
      delete f.artifacts.commonPrestate.snapshot.categories.function[0].detail.searchPath;
    },
    "dependency_detail_incomplete",
  ],
  [
    "missing helper settings",
    (f) => {
      delete f.artifacts.commonPrestate.snapshot.categories.function[0].detail.settings;
    },
    "dependency_detail_incomplete",
  ],
  [
    "unaccounted helper settings",
    (f) => {
      f.artifacts.commonPrestate.snapshot.categories.function[0].detail.otherSettingCount = 1;
    },
    "dependency_detail_incomplete",
  ],
  [
    "missing helper ACL",
    (f) => {
      delete f.artifacts.commonPrestate.snapshot.categories.function[0].detail.explicitAcl;
    },
    "dependency_detail_incomplete",
  ],
  [
    "missing helper result",
    (f) => {
      delete f.artifacts.commonPrestate.snapshot.categories.function[0].detail.result;
    },
    "dependency_detail_incomplete",
  ],
  [
    "invalid helper volatility",
    (f) => {
      f.artifacts.commonPrestate.snapshot.categories.function[0].detail.volatility = "unknown";
    },
    "dependency_detail_incomplete",
  ],
  [
    "completion flag without closure",
    (f) => {
      delete f.artifacts.compatibility.dependencyClosure;
    },
    "dependency_closure_reference_required",
  ],
  [
    "closure bound to other inputs",
    (f) => {
      f.observations["closure.json"].prestateInputsSha256 = "0".repeat(64);
    },
    "dependency_closure_binding",
  ],
  [
    "closure missing relation",
    (f) => {
      f.observations["closure.json"].snapshots.source.relations.pop();
    },
    "dependency_closure_incomplete",
  ],
  [
    "closure missing helper",
    (f) => {
      f.observations["closure.json"].snapshots.source.routines.pop();
    },
    "dependency_closure_incomplete",
  ],
  [
    "closure changed helper metadata",
    (f) => {
      f.observations["closure.json"].snapshots.source.routines[0].detailSha256 = "0".repeat(64);
    },
    "dependency_helper_binding",
  ],
  [
    "unresolved dynamic helper",
    (f) => {
      const ref = f.observations["closure.json"].snapshots.source.routines[0].observation;
      f.observations[ref.path].unresolvedReferences = 1;
    },
    "dependency_observation_incomplete",
  ],
  [
    "unrecorded helper dependency",
    (f) => {
      const ref = f.observations["closure.json"].snapshots.source.routines[0].observation;
      f.observations[ref.path].functionDependencies = ["public.missing_helper()"];
    },
    "dependency_observation_incomplete",
  ],
]) {
  test(`review correction rejects ${name}`, () => {
    const fixture = syntheticRuntimeShapes();
    mutate(fixture);
    assert.throws(
      () => inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture),
      new RegExp(`^Error: connector_proof_${code}$`, "u"),
    );
  });
}

test("paired helper security changes cannot hide behind recomputed snapshot hashes", () => {
  const fixture = syntheticRuntimeShapes();
  const capture = fixture.artifacts.sourceCapture;
  capture.snapshot.categories.function[0].detail.settings = ["search_path=public"];
  capture.snapshot.categories.function[0].detail.searchPath = ["search_path=public"];
  capture.snapshotSha256 = digestMigrationSchemaSnapshot(capture.snapshot);
  assert.throws(
    () => inspectConnectorRuntimeEvidence(fixture.value, fixture.artifacts, fixture),
    /connector_proof_paired_fingerprint_mismatch/u,
  );
});
