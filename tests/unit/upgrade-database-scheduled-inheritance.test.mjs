import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHEDULED_TABLE_NAMES,
  SCHEDULED_TABLE_SQL,
  buildScheduledTableEvidence,
  validateScheduledTableCapture,
} from "../../scripts/release/upgrade-database-scheduled-tables.mjs";

const versions = ["20260823092107", "20260823092450"];
function capture() {
  return {
    schemaVersion: 1,
    captureKind: "scheduled-table-catalog",
    capturedAt: "2026-09-19T20:00:00.000Z",
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: versions.length,
    ledgerVersions: [...versions],
    tableCount: 2,
    tables: SCHEDULED_TABLE_NAMES.map((name) => ({
      schema: "public",
      name,
      kind: "r",
      owner: "postgres",
      persistence: "p",
      rowSecurity: true,
      forceRowSecurity: false,
      replicaIdentity: "d",
      partition: false,
      parentCount: 0,
      attributeSlots: 1,
      droppedColumns: [],
      columns: [
        {
          ordinal: 1,
          name: "id",
          type: "uuid",
          dimensions: 0,
          notNull: true,
          identity: "",
          generated: "",
          aclIsNull: true,
          defaultSha256: null,
          collation: null,
        },
      ],
      constraints: [],
      inboundForeignKeys: [],
      indexes: [],
      aclIsNull: true,
      acl: [],
      columnAcl: [],
      effectivePrivileges: ["anon", "authenticated", "service_role"].map((role) => ({
        role,
        schemaUsage: true,
        privileges: [],
      })),
      policies: [],
      triggers: [],
    })),
  };
}

test("scheduled inheritance: target selection excludes parents of any inheritance child", () => {
  const target = SCHEDULED_TABLE_SQL.match(/with target as \(([\s\S]*?)\n\), rows as \(/u)?.[1];
  assert.ok(target, "expected the actual collector target selection");
  assert.match(target, /and not exists \(select 1 from pg_inherits h where h\.inhparent=c\.oid\)/u);
  // Do not limit the guard to public children or to completed detach operations.
  assert.doesNotMatch(target, /relhassubclass|inhdetachpending|h\.inhrelid=c\.oid/u);
});

test("scheduled inheritance: complete ordinary-table captures remain accepted", () => {
  assert.deepEqual(validateScheduledTableCapture(capture(), versions), capture());
});

for (const omitted of SCHEDULED_TABLE_NAMES) {
  test(`scheduled inheritance: an excluded ${omitted} cannot become passing evidence`, () => {
    const upgraded = capture();
    upgraded.tables = upgraded.tables.filter((row) => row.name !== omitted);
    upgraded.tableCount = upgraded.tables.length;
    assert.throws(
      () => validateScheduledTableCapture(upgraded, versions),
      /upgrade_scheduled_tables_invalid/u,
    );
    assert.throws(
      () =>
        buildScheduledTableEvidence({
          baseline: capture(),
          upgraded,
          baselineVersions: versions,
          finalVersions: versions,
          sourceCommit: "a".repeat(40),
          sourceTree: "b".repeat(40),
        }),
      /upgrade_scheduled_tables_invalid/u,
    );
  });
}

test("scheduled inheritance: excluding both targets cannot be treated as empty equality", () => {
  const observed = { ...capture(), tables: [], tableCount: 0 };
  assert.throws(
    () => validateScheduledTableCapture(observed, versions),
    /upgrade_scheduled_tables_invalid/u,
  );
});

test("scheduled inheritance: the existing inherited-child rejection remains enforced", () => {
  const observed = capture();
  observed.tables[0].parentCount = 1;
  assert.throws(
    () => validateScheduledTableCapture(observed, versions),
    /upgrade_scheduled_tables_invalid/u,
  );
});
