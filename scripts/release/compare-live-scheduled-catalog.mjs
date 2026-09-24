import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEDULED_TABLE_FILE,
  SCHEDULED_TABLE_QUERY_SHA256,
  buildScheduledTableEvidence,
} from "./upgrade-database-scheduled-tables.mjs";
import {
  SCHEDULED_CATALOG_FILE,
  SCHEDULED_CATALOG_QUERY_SHA256,
  buildScheduledCatalogEvidence,
} from "./upgrade-database-scheduled-catalog.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const SHA40 = /^[a-f0-9]{40}$/u;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => {
  throw new Error(`scheduled_live_comparison_${reason}`);
};

function readJson(path) {
  let bytes;
  try {
    bytes = readFileSync(resolve(path));
  } catch {
    fail("file_unavailable");
  }
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) fail("file_size_invalid");
  try {
    return { bytes, data: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail("json_invalid");
  }
}

function checkedArtifact(receipt, key, path, expectedName, expectedQuery, expectedKind) {
  const pointer = receipt[key];
  if (
    !pointer ||
    pointer.file !== expectedName ||
    !SHA256.test(pointer.sha256 ?? "") ||
    pointer.querySha256 !== expectedQuery ||
    basename(resolve(path)) !== expectedName
  )
    fail("receipt_invalid");
  const { bytes, data } = readJson(path);
  if (
    digest(bytes) !== pointer.sha256 ||
    data.querySha256 !== expectedQuery ||
    data.captureKind !== expectedKind ||
    data.sourceCommit !== receipt.sourceCommit ||
    !SHA40.test(data.sourceTree ?? "") ||
    data.schemaProofPromoted !== false ||
    data.productionReleaseReady !== false ||
    data.baseline?.capture?.ledgerVersionCount !== receipt.baselineVersions
  )
    fail("artifact_invalid");
  return { data, sha256: digest(bytes) };
}

// The catalog collectors validate and deterministically order every grant and
// effective privilege before these are passed here. Keep explicit grants
// separate from effective access: PUBLIC grants and role inheritance can make
// the two inventories differ without changing a function definition or RLS.
export function scheduledGrantDeltas(beforeCapture, liveCapture, kind) {
  if (!["tables", "routines"].includes(kind)) fail("grant_scope_invalid");
  const before = beforeCapture[kind];
  const live = liveCapture[kind];
  const identity =
    kind === "tables"
      ? (row) => `${row.schema}.${row.name}`
      : (row) => JSON.stringify([row.schema, row.name, row.identityArguments]);
  const identityKey = (grant) =>
    JSON.stringify(
      kind === "tables"
        ? [grant.column ?? null, grant.grantee, grant.grantor, grant.privilege, grant.grantable]
        : [grant.grantee, grant.grantor, grant.privilege, grant.grantable],
    );
  const byIdentity = new Map(before.map((row) => [identity(row), row]));
  const liveIds = new Set(live.map(identity));
  const grantProperties = kind === "tables" ? ["acl", "columnAcl"] : ["acl"];
  const singleScope = (row, scopeKind) => ({
    identity: identity(row),
    kind: scopeKind,
    explicitGrants: Object.fromEntries(
      grantProperties.map((property) => [
        property,
        {
          sourceOnly: scopeKind === "removed_scope" ? row[property] : [],
          liveOnly: scopeKind === "added_scope" ? row[property] : [],
        },
      ]),
    ),
    effectiveChanges: row.effectivePrivileges.map((privileges) => ({
      role: privileges.role,
      source: scopeKind === "removed_scope" ? privileges : null,
      live: scopeKind === "added_scope" ? privileges : null,
    })),
    ...(kind === "tables" ? { columnEffectiveAccess: "not_captured" } : {}),
  });
  return [
    ...before
      .filter((row) => !liveIds.has(identity(row)))
      .map((row) => singleScope(row, "removed_scope")),
    ...live.flatMap((row) => {
      const original = byIdentity.get(identity(row));
      if (!original) return [singleScope(row, "added_scope")];
      const explicitGrants = Object.fromEntries(
        grantProperties.map((property) => {
          const old = new Set(original[property].map(identityKey));
          const newer = new Set(row[property].map(identityKey));
          return [
            property,
            {
              sourceOnly: original[property].filter((grant) => !newer.has(identityKey(grant))),
              liveOnly: row[property].filter((grant) => !old.has(identityKey(grant))),
            },
          ];
        }),
      );
      const effectiveChanges = row.effectivePrivileges.flatMap((current, index) => {
        const previous = original.effectivePrivileges[index];
        if (JSON.stringify(previous) === JSON.stringify(current)) return [];
        return [{ role: current.role, source: previous, live: current }];
      });
      const columnAclStorageChanged =
        kind === "tables" &&
        original.columns.some((column) => {
          const current = row.columns.find(({ name }) => name === column.name);
          return current !== undefined && current.aclIsNull !== column.aclIsNull;
        });
      if (
        original.aclIsNull === row.aclIsNull &&
        !columnAclStorageChanged &&
        !effectiveChanges.length &&
        Object.values(explicitGrants).every(
          (delta) => !delta.sourceOnly.length && !delta.liveOnly.length,
        )
      )
        return [];
      return [
        {
          identity: identity(row),
          ...(kind === "tables"
            ? {
                aclIsNull: { source: original.aclIsNull, live: row.aclIsNull },
                columnAclStorageChanged,
                columnEffectiveAccess: "not_captured",
              }
            : {}),
          explicitGrants,
          effectiveChanges,
        },
      ];
    }),
  ];
}

function compareOne(artifact, live, build, key) {
  if (
    Date.parse(live.data.capturedAt) < Date.parse(artifact.data.baseline.capture.capturedAt) ||
    Date.parse(live.data.capturedAt) < Date.parse(artifact.data.upgraded.capture.capturedAt)
  )
    fail("live_capture_not_current");
  const common = {
    upgraded: live.data,
    finalVersions: live.data.ledgerVersions,
    sourceCommit: artifact.data.sourceCommit,
    sourceTree: artifact.data.sourceTree,
  };
  const baseline = build({
    ...common,
    baseline: artifact.data.baseline.capture,
    baselineVersions: artifact.data.baseline.capture.ledgerVersions,
  });
  const sourceFinal = build({
    ...common,
    baseline: artifact.data.upgraded.capture,
    baselineVersions: artifact.data.upgraded.capture.ledgerVersions,
  });
  if (
    JSON.stringify(baseline.baseline.fingerprint) !==
      JSON.stringify(artifact.data.baseline.fingerprint) ||
    JSON.stringify(sourceFinal.baseline.fingerprint) !==
      JSON.stringify(artifact.data.upgraded.fingerprint) ||
    baseline.schemaProofPromoted !== false ||
    sourceFinal.schemaProofPromoted !== false
  )
    fail("artifact_fingerprint_mismatch");
  if (
    JSON.stringify(live.data.ledgerVersions) !==
    JSON.stringify(artifact.data.baseline.capture.ledgerVersions)
  )
    fail("live_ledger_mismatch");
  return {
    querySha256: artifact.data.querySha256,
    artifactSha256: artifact.sha256,
    liveCaptureSha256: live.sha256,
    capturedAt: live.data.capturedAt,
    liveLedgerVersionCount: live.data.ledgerVersionCount,
    baseline: {
      fingerprint: baseline.baseline.fingerprint,
      changes: baseline.changes,
      grantDeltas: scheduledGrantDeltas(
        baseline.baseline.capture,
        baseline.upgraded.capture,
        key === "tableCatalogMatch" ? "tables" : "routines",
      ),
    },
    sourceFinal: {
      fingerprint: sourceFinal.baseline.fingerprint,
      changes: sourceFinal.changes,
      grantDeltas: scheduledGrantDeltas(
        sourceFinal.baseline.capture,
        sourceFinal.upgraded.capture,
        key === "tableCatalogMatch" ? "tables" : "routines",
      ),
    },
    liveFingerprint: baseline.upgraded.fingerprint,
    [key]: baseline.changes.length === 0,
  };
}

export function compareLiveScheduledCatalog({
  receiptPath,
  tableArtifactPath,
  routineArtifactPath,
  liveTablePath,
  liveRoutinePath,
}) {
  const receipt = readJson(receiptPath).data;
  if (
    receipt.passed !== true ||
    receipt.executed !== true ||
    !SHA40.test(receipt.sourceCommit ?? "") ||
    receipt.currentHistory?.requiresCanonicalHistoryReconciliation !== true ||
    receipt.currentHistory?.productionReleaseReady !== false
  )
    fail("receipt_invalid");
  const table = checkedArtifact(
    receipt,
    "scheduledTables",
    tableArtifactPath,
    SCHEDULED_TABLE_FILE,
    SCHEDULED_TABLE_QUERY_SHA256,
    "scheduled-table-checkpoints",
  );
  const routine = checkedArtifact(
    receipt,
    "scheduledCatalog",
    routineArtifactPath,
    SCHEDULED_CATALOG_FILE,
    SCHEDULED_CATALOG_QUERY_SHA256,
    "scheduled-execution-routine-checkpoints",
  );
  if (
    table.data.sourceTree !== routine.data.sourceTree ||
    JSON.stringify(table.data.baseline.capture.ledgerVersions) !==
      JSON.stringify(routine.data.baseline.capture.ledgerVersions) ||
    JSON.stringify(table.data.upgraded.capture.ledgerVersions) !==
      JSON.stringify(routine.data.upgraded.capture.ledgerVersions)
  )
    fail("artifact_checkpoint_mismatch");
  const tableLive = readJson(liveTablePath),
    routineLive = readJson(liveRoutinePath);
  if (
    JSON.stringify(tableLive.data.ledgerVersions) !==
    JSON.stringify(routineLive.data.ledgerVersions)
  )
    fail("live_ledger_mismatch");
  return {
    schemaVersion: 1,
    artifactKind: "scheduled-live-catalog-comparison",
    sourceCommit: receipt.sourceCommit,
    sourceTree: table.data.sourceTree,
    tables: compareOne(
      table,
      { data: tableLive.data, sha256: digest(tableLive.bytes) },
      buildScheduledTableEvidence,
      "tableCatalogMatch",
    ),
    routines: compareOne(
      routine,
      { data: routineLive.data, sha256: digest(routineLive.bytes) },
      buildScheduledCatalogEvidence,
      "routineCatalogMatch",
    ),
    schemaProofPromoted: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 5) fail("usage");
  console.log(
    JSON.stringify(
      compareLiveScheduledCatalog({
        receiptPath: args[0],
        tableArtifactPath: args[1],
        routineArtifactPath: args[2],
        liveTablePath: args[3],
        liveRoutinePath: args[4],
      }),
      null,
      2,
    ),
  );
}
