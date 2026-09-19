import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MANIFEST, planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import {
  SCHEDULED_TABLE_FILE,
  SCHEDULED_TABLE_NAMES,
  SCHEDULED_TABLE_SQL,
  SCHEDULED_TABLE_QUERY_SHA256,
  parseScheduledTableCapture,
  validateScheduledTableCapture,
  buildScheduledTableEvidence,
} from "../../scripts/release/upgrade-database-scheduled-tables.mjs";
import { TEMP_EXPORT_CATALOG_SQL } from "../../scripts/release/upgrade-database-temp-export-proof.mjs";
import {
  SCHEDULED_CATALOG_SQL,
  SCHEDULED_ROUTINE_NAMES,
} from "../../scripts/release/upgrade-database-scheduled-catalog.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = ["20260823092107", "20260823092450", "20260824085042"];
const FINAL = [...BASE, "20260905005111"];
const roles = ["anon", "authenticated", "service_role"];
const sha = "a".repeat(64),
  sourceCommit = "b".repeat(40),
  sourceTree = "c".repeat(40);
const digest = (b) => createHash("sha256").update(b).digest("hex");
function table(name) {
  return {
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
        defaultSha256: sha,
        collation: null,
      },
    ],
    constraints: [
      {
        name: `${name}_pkey`,
        kind: "p",
        validated: true,
        deferrable: false,
        initiallyDeferred: false,
        definitionSha256: sha,
      },
    ],
    indexes: [
      {
        name: `${name}_pkey`,
        primary: true,
        unique: true,
        valid: true,
        ready: true,
        replicaIdentity: false,
        nullsNotDistinct: false,
        definitionSha256: sha,
      },
    ],
    aclIsNull: false,
    acl: [{ grantor: "postgres", grantee: "service_role", privilege: "SELECT", grantable: false }],
    columnAcl: [],
    effectivePrivileges: roles.map((role) => ({
      role,
      schemaUsage: true,
      privileges: role === "service_role" ? ["SELECT"] : [],
    })),
    policies: [
      {
        name: "owner_read",
        command: "r",
        permissive: true,
        roles: ["authenticated"],
        usingSha256: sha,
        checkSha256: null,
      },
    ],
    triggers: [
      {
        name: "touch",
        enabled: "O",
        function: "public.touch_updated_at()",
        definitionSha256: sha,
        functionDefinitionSha256: sha,
      },
    ],
  };
}
function capture(versions = BASE) {
  return {
    schemaVersion: 1,
    captureKind: "scheduled-table-catalog",
    capturedAt: "2026-09-19T16:00:00.000Z",
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: versions.length,
    ledgerVersions: [...versions],
    tableCount: 2,
    tables: SCHEDULED_TABLE_NAMES.map(table),
  };
}
const build = (before = capture(), after = capture(FINAL)) =>
  buildScheduledTableEvidence({
    baseline: before,
    upgraded: after,
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit,
    sourceTree,
  });

test("scheduled tables: equivalent metadata retains provenance without promoting any proof", () => {
  const result = build();
  assert.equal(result.querySha256, digest(SCHEDULED_TABLE_SQL));
  assert.equal(result.querySha256, SCHEDULED_TABLE_QUERY_SHA256);
  assert.deepEqual(result.baseline.fingerprint, result.upgraded.fingerprint);
  assert.notEqual(result.baseline.ledgerVersionsSha256, result.upgraded.ledgerVersionsSha256);
  assert.equal(result.tableCatalogMatch, true);
  assert.deepEqual(result.changes, []);
  for (const flag of [
    "schemaProofPromoted",
    "liveCatalogCompared",
    "canonicalHistoryReconciled",
    "productionReleaseReady",
    "productionRowsRestored",
  ])
    assert.equal(result[flag], false);
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.sourceTree, sourceTree);
});
test("scheduled tables: key ordering cannot masquerade as a catalog change", () => {
  const reordered = JSON.parse(JSON.stringify(capture(FINAL)), (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).reverse())
      : v,
  );
  assert.equal(build(capture(), reordered).tableCatalogMatch, true);
});
for (const [path, value] of [
  ["schemaVersion", "1"],
  ["captureKind", "wrong"],
  ["capturedAt", "2026-02-30T16:00:00.000Z"],
  ["capturedAt", "2026-09-19T16:00:00Z"],
  ["postgresVersionNum", 160006],
  ["databaseName", "other"],
  ["readOnly", false],
  ["isolation", "read committed"],
  ["catalogSentinelPresent", false],
  ["publicSchemaPresent", false],
  ["ledgerVersionCount", "3"],
  ["tableCount", 1],
  ["tables.0.schema", "private"],
  ["tables.0.name", "unrelated"],
  ["tables.0.kind", "v"],
  ["tables.0.rowSecurity", "true"],
  ["tables.0.parentCount", 1],
  ["tables.0.partition", true],
  ["tables.0.persistence", "t"],
  ["tables.0.columns.0.ordinal", 0],
  ["tables.0.columns.0.type", null],
  ["tables.0.columns.0.defaultSha256", "bad"],
  ["tables.0.columns.0.identity", "z"],
  ["tables.0.columns.0.notNull", 1],
  ["tables.0.constraints.0.validated", "true"],
  ["tables.0.constraints.0.kind", "z"],
  ["tables.0.indexes.0.ready", null],
  ["tables.0.indexes.0.replicaIdentity", "false"],
  ["tables.0.aclIsNull", "true"],
  ["tables.0.indexes.0.definitionSha256", "0".repeat(63)],
  ["tables.0.acl.0.privilege", "EXECUTE"],
  ["tables.0.acl.0.grantable", "false"],
  ["tables.0.effectivePrivileges.0.role", "other"],
  ["tables.0.policies.0.command", "SELECT"],
  ["tables.0.policies.0.usingSha256", "bad"],
  ["tables.0.triggers.0.enabled", "x"],
  ["tables.0.triggers.0.functionDefinitionSha256", null],
])
  test(`scheduled tables: malformed ${path} is rejected`, () => {
    const c = capture();
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((v, k) => v[k], c)[last] = value;
    assert.throws(
      () => validateScheduledTableCapture(c, BASE),
      /upgrade_scheduled_tables_invalid/u,
    );
  });
for (const path of [
  "",
  "tables.0",
  "tables.0.columns.0",
  "tables.0.constraints.0",
  "tables.0.indexes.0",
  "tables.0.acl.0",
  "tables.0.policies.0",
  "tables.0.triggers.0",
])
  test(`scheduled tables: reject unrequested field at ${path || "root"}`, () => {
    const c = capture();
    const target = path ? path.split(".").reduce((v, k) => v[k], c) : c;
    target.extra = "do not retain";
    assert.throws(() => validateScheduledTableCapture(c, BASE), /invalid/u);
  });
test("scheduled tables: exact ordered histories and complete inventories are mandatory", () => {
  for (const mutate of [
    (c) => c.tables.pop(),
    (c) => c.tables.reverse(),
    (c) => {
      c.tables[1] = structuredClone(c.tables[0]);
    },
    (c) => c.ledgerVersions.reverse(),
    (c) => {
      c.ledgerVersions[2] = "20260824085043";
    },
    (c) => c.tables[0].columns.push(structuredClone(c.tables[0].columns[0])),
    (c) => c.tables[0].acl.push(structuredClone(c.tables[0].acl[0])),
    (c) => c.tables[0].effectivePrivileges.reverse(),
    (c) => c.tables[0].policies[0].roles.push("authenticated"),
  ]) {
    const c = capture();
    mutate(c);
    assert.throws(() => validateScheduledTableCapture(c, BASE), /invalid/u);
  }
  assert.throws(
    () => validateScheduledTableCapture(capture(["20260905005111"]), ["20260905005111"]),
    /invalid/u,
  );
});
test("scheduled tables: dropped ordinal gaps are valid but repeated column names are not", () => {
  const c = capture();
  c.tables[0].columns.push({ ...c.tables[0].columns[0], ordinal: 3, name: "title" });
  assert.doesNotThrow(() => validateScheduledTableCapture(c, BASE));
  c.tables[0].columns[1].name = "id";
  assert.throws(() => validateScheduledTableCapture(c, BASE), /invalid/u);
});
test("scheduled tables: a column grant must reference a captured column", () => {
  const c = capture();
  c.tables[0].columnAcl.push({ column: "missing", ...c.tables[0].acl[0] });
  assert.throws(() => validateScheduledTableCapture(c, BASE), /invalid/u);
});
test("scheduled tables: actual ACL and RLS differences remain differences", () => {
  const c = capture(FINAL);
  c.tables[0].rowSecurity = false;
  c.tables[0].policies[0].checkSha256 = sha;
  c.tables[1].acl[0].grantable = true;
  const result = build(capture(), c);
  assert.equal(result.tableCatalogMatch, false);
  assert.equal(result.changes.length, 2);
  assert.notEqual(result.baseline.fingerprint.rls, result.upgraded.fingerprint.rls);
  assert.notEqual(result.baseline.fingerprint.acl, result.upgraded.fingerprint.acl);
  assert.equal(result.schemaProofPromoted, false);
});
test("scheduled tables: bad output and source identity cannot publish evidence", () => {
  for (const data of ["", null, "{}\n{}", "x".repeat(1024 * 1024 + 1)])
    assert.throws(() => parseScheduledTableCapture(data, BASE), /invalid/u);
  const options = {
    baseline: capture(),
    upgraded: capture(FINAL),
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit,
    sourceTree,
  };
  for (const bad of ["main", null, "a".repeat(39)])
    assert.throws(() => buildScheduledTableEvidence({ ...options, sourceCommit: bad }), /invalid/u);
  const c = capture(FINAL);
  c.capturedAt = "2026-09-19T15:00:00.000Z";
  assert.throws(() => build(capture(), c), /invalid/u);
  assert.deepEqual(parseScheduledTableCapture(JSON.stringify(capture()), BASE), capture());
});
test("scheduled tables: bounded SQL reads metadata without table rows or application calls", () => {
  assert.match(
    SCHEDULED_TABLE_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(SCHEDULED_TABLE_SQL, /statement_timeout = '10s'/u);
  assert.match(SCHEDULED_TABLE_SQL, /lock_timeout = '1s'/u);
  assert.doesNotMatch(
    SCHEDULED_TABLE_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy)\s+(?:into|table|schema|function|public\.)/iu,
  );
  assert.doesNotMatch(SCHEDULED_TABLE_SQL, /from\s+(?:public|auth|storage|vault)\./iu);
  assert.doesNotMatch(SCHEDULED_TABLE_SQL, /public\.(?:claim|settle|complete|recover|fail)_/u);
  assert.match(SCHEDULED_TABLE_SQL, /has_table_privilege/u);
  assert.match(SCHEDULED_TABLE_SQL, /pg_policy/u);
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kova-table-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["supabase/migrations", dirname(MANIFEST), "scripts/release"])
    cpSync(join(ROOT, path), join(root, path), { recursive: true });
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mock CLI");
  const plan = extendCurrentHistory(
    planUpgrade(root),
    readFileSync(join(root, CURRENT_HISTORY_SNAPSHOT)),
  );
  return {
    root,
    before: plan.baseline.map((r) => r.version).sort(),
    after: [...plan.baseline, ...plan.executionForward].map((r) => r.version).sort(),
  };
}
function runner(data, hook = () => null) {
  const calls = [],
    counts = new Map();
  return {
    calls,
    execute(command, args, options) {
      const call = { command, args, ...options };
      calls.push(call);
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(
        !args.includes("--linked") && !args.includes("--db-url") && !args.includes("repair"),
      );
      const intercepted = hook(call);
      if (intercepted) return intercepted;
      let output = "";
      if (command === "git") output = args.at(-1) === "HEAD^{tree}" ? sourceTree : sourceCommit;
      if (
        [SCHEDULED_TABLE_SQL, TEMP_EXPORT_CATALOG_SQL, SCHEDULED_CATALOG_SQL].includes(
          options.input,
        )
      ) {
        assert.equal(command, "docker");
        for (const flag of ["-A", "-t", "-q"]) assert.ok(args.includes(flag));
        const number = (counts.get(options.input) || 0) + 1;
        counts.set(options.input, number);
        const vers = number === 1 ? data.before : data.after;
        if (options.input === SCHEDULED_TABLE_SQL) output = JSON.stringify(capture(vers));
        else if (options.input === TEMP_EXPORT_CATALOG_SQL)
          output = JSON.stringify({
            schemaVersion: 1,
            captureKind: "temporary-export-catalog-absence",
            capturedAt: "2026-09-19T16:00:00.000Z",
            postgresVersionNum: 170006,
            databaseName: "postgres",
            readOnly: true,
            isolation: "repeatable read",
            publicSchemaPresent: true,
            catalogSentinelPresent: true,
            exactSignaturePresent: false,
            routineFamilyCount: 0,
            inboundDependencyCount: 0,
            storedReferenceCount: 0,
            ledgerVersionCount: vers.length,
            ledgerVersions: vers,
          });
        else
          output = JSON.stringify({
            schemaVersion: 1,
            captureKind: "scheduled-execution-routine-catalog",
            capturedAt: "2026-09-19T16:00:00.000Z",
            postgresVersionNum: 170006,
            databaseName: "postgres",
            readOnly: true,
            isolation: "repeatable read",
            publicSchemaPresent: true,
            catalogSentinelPresent: true,
            ledgerVersionCount: vers.length,
            ledgerVersions: vers,
            routineCount: 7,
            routines: SCHEDULED_ROUTINE_NAMES.map((name) => ({
              schema: "public",
              name,
              kind: "f",
              identityArguments: "",
              result: "void",
              owner: "postgres",
              language: "plpgsql",
              securityDefiner: true,
              strict: false,
              volatility: "v",
              parallel: "u",
              leakproof: false,
              returnsSet: false,
              defaultArgumentCount: 0,
              bodyBytes: 1,
              bodySha256: sha,
              definitionSha256: sha,
              searchPath: ["search_path=public"],
              configurationSha256: sha,
              acl: [
                {
                  grantor: "postgres",
                  grantee: "service_role",
                  privilege: "EXECUTE",
                  grantable: false,
                },
              ],
              effectivePrivileges: roles.map((role) => ({
                role,
                schemaUsage: true,
                execute: role === "service_role",
              })),
            })),
          });
      }
      return { status: 0, stdout: output, stderr: "" };
    },
    inspectSource: () => ({
      commit: sourceCommit,
      tree: sourceTree,
      trackedFileCount: 1,
      readFile: readFileSync,
      readDirectory: readdirSync,
    }),
  };
}
for (const all of [false, true])
  test(`scheduled tables: ${all ? "three collectors" : "tables alone"} bind captures and publish only after cleanup`, (t) => {
    const data = fixture(t),
      r = runner(data, () => {
        assert.equal(existsSync(join(data.root, "artifacts/release", SCHEDULED_TABLE_FILE)), false);
        return null;
      });
    const result = rehearseUpgrade({
      root: data.root,
      currentHistory: true,
      captureScheduledTables: true,
      captureTemporaryExport: all,
      captureScheduledCatalog: all,
      execute: r.execute,
      inspectSource: r.inspectSource,
    });
    const bytes = readFileSync(join(data.root, "artifacts/release", SCHEDULED_TABLE_FILE)),
      proof = JSON.parse(bytes);
    assert.equal(result.scheduledTables.sha256, digest(bytes));
    assert.equal(result.scheduledTables.querySha256, SCHEDULED_TABLE_QUERY_SHA256);
    assert.equal(proof.sourceCommit, sourceCommit);
    assert.equal(proof.sourceTree, sourceTree);
    assert.equal(proof.baseline.capture.ledgerVersionCount, 98);
    assert.equal(proof.upgraded.capture.ledgerVersionCount, 180);
    assert.equal(result.forwardMigrations.length, 82);
    assert.equal(proof.schemaProofPromoted, false);
    const sql = r.calls.filter((c) => c.command === "docker").map((c) => c.input);
    assert.equal(sql.filter((s) => s === SCHEDULED_TABLE_SQL).length, 2);
    assert.ok(
      sql.indexOf(SCHEDULED_TABLE_SQL) < sql.findIndex((s) => s.includes("Synthetic fixtures")),
    );
    assert.equal(sql.at(-1), SCHEDULED_TABLE_SQL);
    assert.equal(r.calls.at(-1).args[0], "stop");
    assert.equal(existsSync(r.calls[0].cwd), false);
    if (all) {
      assert.ok(result.temporaryExportProof);
      assert.ok(result.scheduledCatalog);
    }
  });
for (const failure of ["baseline", "upgraded", "cleanup", "final-source"])
  test(`scheduled tables: ${failure} failure leaves no success artifacts`, (t) => {
    const data = fixture(t),
      dir = join(data.root, "artifacts/release");
    mkdirSync(dir, { recursive: true });
    for (const name of ["upgrade-database.json", SCHEDULED_TABLE_FILE])
      writeFileSync(join(dir, name), "old success");
    let queries = 0,
      inspections = 0;
    const r = runner(data, (c) => {
      if (c.input === SCHEDULED_TABLE_SQL) {
        queries++;
        if (queries === (failure === "baseline" ? 1 : failure === "upgraded" ? 2 : -1))
          return { status: 0, stdout: "{}", stderr: "" };
      }
      if (failure === "cleanup" && c.args[0] === "stop")
        return { status: 1, stdout: "", stderr: "synthetic failure" };
      return null;
    });
    assert.throws(
      () =>
        rehearseUpgrade({
          root: data.root,
          currentHistory: true,
          captureScheduledTables: true,
          execute: r.execute,
          inspectSource: () => {
            inspections++;
            if (failure === "final-source" && inspections === 2)
              throw Error("upgrade_source_changed_during_rehearsal");
            return r.inspectSource();
          },
        }),
      failure === "cleanup"
        ? /upgrade_local_cleanup_failed/u
        : failure === "final-source"
          ? /upgrade_source_changed_during_rehearsal/u
          : /upgrade_scheduled_tables_invalid/u,
    );
    for (const name of ["upgrade-database.json", SCHEDULED_TABLE_FILE])
      assert.equal(existsSync(join(dir, name)), false);
    assert.equal(r.calls.at(-1).args[0], "stop");
    assert.equal(existsSync(r.calls[0].cwd), false);
    if (failure === "baseline") assert.ok(!r.calls.some((c) => c.args[0] === "migration"));
  });
test("scheduled tables: dry runs are observational and historical capture is rejected", (t) => {
  const data = fixture(t),
    dir = join(data.root, "artifacts/release");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SCHEDULED_TABLE_FILE), "unchanged");
  const no = () => assert.fail("must not execute");
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureScheduledTables: true,
    dryRun: true,
    execute: no,
    inspectSource: no,
  });
  assert.equal(result.executed, false);
  assert.equal(result.scheduledTablesPlanned, true);
  assert.throws(
    () =>
      rehearseUpgrade({
        root: data.root,
        captureScheduledTables: true,
        dryRun: true,
        execute: no,
        inspectSource: no,
      }),
    /current_history_required/u,
  );
  assert.equal(readFileSync(join(dir, SCHEDULED_TABLE_FILE), "utf8"), "unchanged");
  assert.throws(
    () =>
      rehearseUpgrade({
        root: data.root,
        captureScheduledTables: true,
        execute: no,
        inspectSource: no,
      }),
    /current_history_required/u,
  );
  assert.equal(existsSync(join(dir, SCHEDULED_TABLE_FILE)), false);
});

test("scheduled tables: expected plan ordering is immaterial but observed ordering remains strict", () => {
  assert.doesNotThrow(() => validateScheduledTableCapture(capture(), [...BASE].reverse()));
  const value = capture();
  value.ledgerVersions.reverse();
  assert.throws(() => validateScheduledTableCapture(value, BASE), /invalid/u);
});

test("scheduled tables: implicit and explicit default ACLs remain different evidence", () => {
  const before = capture();
  const after = capture(FINAL);
  before.tables[0].aclIsNull = true;
  after.tables[0].aclIsNull = false;
  // Both expanded ACL inventories are identical; only their catalog storage differs.
  const defaults = [
    "DELETE",
    "INSERT",
    "MAINTAIN",
    "REFERENCES",
    "SELECT",
    "TRIGGER",
    "TRUNCATE",
    "UPDATE",
  ].map((privilege) => ({ grantor: "postgres", grantee: "postgres", privilege, grantable: false }));
  before.tables[0].acl = structuredClone(defaults);
  after.tables[0].acl = structuredClone(defaults);
  const result = build(before, after);
  assert.equal(result.tableCatalogMatch, false);
  assert.deepEqual(result.changes, [
    { table: "public.scheduled_task_runs", fields: ["aclIsNull"] },
  ]);
  assert.notEqual(result.baseline.fingerprint.acl, result.upgraded.fingerprint.acl);
  for (const category of ["schema", "rls", "trigger"])
    assert.equal(result.baseline.fingerprint[category], result.upgraded.fingerprint[category]);
  assert.equal(result.baseline.capture.tables[0].aclIsNull, true);
  assert.equal(result.upgraded.capture.tables[0].aclIsNull, false);
  assert.equal(result.schemaProofPromoted, false);
});

test("scheduled tables: changing the chosen existing replica index changes the schema hash", () => {
  const before = capture();
  before.tables[0].replicaIdentity = "i";
  const original = before.tables[0].indexes[0];
  before.tables[0].indexes.push(
    {
      ...original,
      name: "scheduled_task_runs_replica_a",
      primary: false,
      replicaIdentity: true,
      definitionSha256: "d".repeat(64),
    },
    {
      ...original,
      name: "scheduled_task_runs_replica_b",
      primary: false,
      replicaIdentity: false,
      definitionSha256: "e".repeat(64),
    },
  );
  const after = structuredClone(before);
  after.ledgerVersions = [...FINAL];
  after.ledgerVersionCount = FINAL.length;
  after.tables[0].indexes[1].replicaIdentity = false;
  after.tables[0].indexes[2].replicaIdentity = true;
  const result = build(before, after);
  assert.equal(result.tableCatalogMatch, false);
  assert.deepEqual(result.changes, [{ table: "public.scheduled_task_runs", fields: ["indexes"] }]);
  assert.notEqual(result.baseline.fingerprint.schema, result.upgraded.fingerprint.schema);
  for (const category of ["acl", "rls", "trigger"])
    assert.equal(result.baseline.fingerprint[category], result.upgraded.fingerprint[category]);
  assert.deepEqual(
    result.baseline.capture.tables[0].indexes.map(({ replicaIdentity: _flag, ...index }) => index),
    result.upgraded.capture.tables[0].indexes.map(({ replicaIdentity: _flag, ...index }) => index),
  );
  assert.equal(result.productionReleaseReady, false);
});

test("scheduled tables: old captures without storage and replica flags fail instead of guessing", () => {
  for (const field of ["aclIsNull", "replicaIdentity"]) {
    const c = capture();
    if (field === "aclIsNull") delete c.tables[0].aclIsNull;
    else delete c.tables[0].indexes[0].replicaIdentity;
    assert.throws(
      () => validateScheduledTableCapture(c, BASE),
      /upgrade_scheduled_tables_invalid/u,
    );
  }
});

test("scheduled tables: SQL observes raw ACL nullness and the actual replica-identity flag", () => {
  assert.match(SCHEDULED_TABLE_SQL, /'aclIsNull',c\.relacl is null/u);
  assert.match(SCHEDULED_TABLE_SQL, /'replicaIdentity',x\.indisreplident/u);
});
