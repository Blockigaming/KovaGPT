import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCHEDULED_TABLE_SQL,
  SCHEDULED_TABLE_NAMES,
  buildScheduledTableEvidence,
} from "../../scripts/release/upgrade-database-scheduled-tables.mjs";

const target = SCHEDULED_TABLE_SQL.match(/with target as \(([\s\S]*?)\n\), rows as \(/u)?.[1];

for (const [name, expression] of [
  [
    "effective publication membership including all-table and schema publications",
    /not exists \(select 1 from pg_publication_tables p where p\.schemaname=n\.nspname and p\.tablename=c\.relname\)/u,
  ],
  ["relation options", /and c\.reloptions is null/u],
  [
    "TOAST options",
    /not exists \(select 1 from pg_class toast where toast\.oid=c\.reltoastrelid and toast\.reloptions is not null\)/u,
  ],
  [
    "constraint triggers on both sides of a foreign key",
    /internal\.tgisinternal\s+and \(internal\.tgrelid=c\.oid or internal\.tgconstrrelid=c\.oid\) and internal\.tgenabled<>'O'/u,
  ],
  [
    "all three API roles' superuser and BYPASSRLS flags",
    /api_role\.rolname in \('anon','authenticated','service_role'\)\s+and \(api_role\.rolsuper or api_role\.rolbypassrls<>\(api_role\.rolname='service_role'\)\)/u,
  ],
  ["explicit table tablespace selection", /and c\.reltablespace=0/u],
  [
    "the database's effective default tablespace",
    /space\.spcname='pg_default' from pg_database db join pg_tablespace space on space\.oid=db\.dattablespace\s+where db\.datname=current_database\(\)/u,
  ],
  [
    "a quoted PUBLIC role distinct from the PUBLIC pseudorole",
    /not exists \(select 1 from pg_roles named_role where named_role\.rolname='PUBLIC'\)/u,
  ],
]) {
  test(`scheduled scope: source query rejects unsupported ${name}`, () => {
    assert.ok(target);
    assert.match(target, expression);
  });
}

function capture() {
  return {
    schemaVersion: 1,
    captureKind: "scheduled-table-catalog",
    capturedAt: "2026-09-19T22:00:00.000Z",
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: 2,
    ledgerVersions: ["20260823092107", "20260823092450"],
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
      columns: [
        {
          ordinal: 1,
          name: "id",
          type: "uuid",
          notNull: true,
          identity: "",
          generated: "",
          aclIsNull: true,
          defaultSha256: null,
          collation: null,
        },
      ],
      constraints: [],
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
function build(baseline, upgraded) {
  return buildScheduledTableEvidence({
    baseline,
    upgraded,
    baselineVersions: baseline.ledgerVersions,
    finalVersions: upgraded.ledgerVersions,
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
  });
}

test("scheduled scope: supported complete observations remain accepted without release promotion", () => {
  const result = build(capture(), capture());
  assert.equal(result.tableCatalogMatch, true);
  assert.equal(result.schemaProofPromoted, false);
  assert.equal(result.productionReleaseReady, false);
});

for (const stage of ["baseline", "upgraded"]) {
  for (const retained of [[], ["scheduled_task_runs"], ["scheduled_tasks"]]) {
    test(`scheduled scope: ${stage} inventory ${JSON.stringify(retained)} cannot produce success`, () => {
      const before = capture(),
        after = capture();
      const failed = stage === "baseline" ? before : after;
      failed.tables = failed.tables.filter(({ name }) => retained.includes(name));
      failed.tableCount = failed.tables.length;
      assert.throws(() => build(before, after), /upgrade_scheduled_tables_invalid/u);
    });
  }
}

test("scheduled scope: documented restrictions match the guarded query instead of claiming complete equivalence", () => {
  const source = readFileSync(
    new URL("../../scripts/release/upgrade-database-scheduled-tables.mjs", import.meta.url),
    "utf8",
  );
  for (const word of [
    "effective publications",
    "relation/TOAST options",
    "internal constraint triggers",
    "API-role authority",
    "tablespaces",
    "named PUBLIC role",
  ]) {
    assert.ok(source.includes(word), word);
  }
});
