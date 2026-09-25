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
import {
  MANIFEST,
  planUpgrade,
  rehearseUpgrade as actualRehearseUpgrade,
} from "../../scripts/release/upgrade-database.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import {
  SCHEDULED_CATALOG_FILE,
  SCHEDULED_ROUTINE_NAMES,
  SCHEDULED_CATALOG_SQL,
  SCHEDULED_CATALOG_QUERY_SHA256,
  validateScheduledCatalogCapture,
  parseScheduledCatalogCapture,
  buildScheduledCatalogEvidence,
} from "../../scripts/release/upgrade-database-scheduled-catalog.mjs";

// Database orchestration is mocked here; real Git/source checks have their own suite.
const rehearseUpgrade = (options = {}) =>
  actualRehearseUpgrade({
    inspectSource: () => ({
      commit: "dddddddddddddddddddddddddddddddddddddddd",
      tree: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      trackedFileCount: 1,
      readFile: readFileSync,
      readDirectory: readdirSync,
    }),
    ...options,
  });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = ["20260823092107", "20260823092450"];
const FINAL = [...BASE, "20260905005111"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
function row(name) {
  return {
    schema: "public",
    name,
    kind: "f",
    identityArguments: "p_id uuid",
    result: "integer",
    owner: "postgres",
    language: "plpgsql",
    securityDefiner: true,
    strict: false,
    volatility: "v",
    parallel: "u",
    leakproof: false,
    returnsSet: false,
    defaultArgumentCount: 0,
    bodyBytes: 42,
    bodySha256: "a".repeat(64),
    definitionSha256: "b".repeat(64),
    searchPath: ["search_path=public"],
    configurationSha256: "c".repeat(64),
    acl: [{ grantor: "postgres", grantee: "service_role", privilege: "EXECUTE", grantable: false }],
    effectivePrivileges: ["anon", "authenticated", "service_role"].map((role) => ({
      role,
      schemaUsage: true,
      execute: role === "service_role",
    })),
  };
}
function capture(versions = BASE, capturedAt = "2026-09-19T12:00:00.000Z") {
  return {
    schemaVersion: 1,
    captureKind: "scheduled-execution-routine-catalog",
    capturedAt,
    postgresVersionNum: 170006,
    databaseName: "postgres",
    readOnly: true,
    isolation: "repeatable read",
    publicSchemaPresent: true,
    catalogSentinelPresent: true,
    ledgerVersionCount: versions.length,
    ledgerVersions: [...versions],
    routineCount: 7,
    routines: SCHEDULED_ROUTINE_NAMES.map(row),
  };
}
function evidence(overrides = {}) {
  return buildScheduledCatalogEvidence({
    baseline: capture(),
    upgraded: capture(FINAL),
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit: "d".repeat(40),
    sourceTree: "e".repeat(40),
    ...overrides,
  });
}

test("scheduled catalog: stable fingerprints retain metadata and explicit incomplete scope", () => {
  const result = evidence();
  assert.equal(result.querySha256, sha256(SCHEDULED_CATALOG_SQL));
  assert.equal(result.querySha256, SCHEDULED_CATALOG_QUERY_SHA256);
  assert.deepEqual(result.baseline.fingerprint, result.upgraded.fingerprint);
  assert.notEqual(result.baseline.ledgerVersionsSha256, result.upgraded.ledgerVersionsSha256);
  assert.equal(result.routineCatalogMatch, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.scope.tableSchemaAclRlsCaptured, false);
  for (const field of [
    "schemaProofPromoted",
    "liveCatalogCompared",
    "canonicalHistoryReconciled",
    "productionReleaseReady",
    "productionRowsRestored",
  ])
    assert.equal(result[field], false);
  assert.equal(result.proofIds.length, 2);
});

test("scheduled catalog: key order does not create a false semantic difference", () => {
  const reordered = JSON.parse(JSON.stringify(capture(FINAL)), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  assert.equal(evidence({ upgraded: reordered }).routineCatalogMatch, true);
});

for (const [field, value] of [
  ["schemaVersion", "1"],
  ["captureKind", "wrong"],
  ["capturedAt", "2026-02-30T12:00:00.000Z"],
  ["capturedAt", "2026-09-19T12:00:00Z"],
  ["postgresVersionNum", "170006"],
  ["postgresVersionNum", 160006],
  ["databaseName", "other"],
  ["readOnly", "true"],
  ["readOnly", false],
  ["isolation", "read committed"],
  ["publicSchemaPresent", false],
  ["catalogSentinelPresent", false],
  ["routineCount", "7"],
  ["routineCount", 8],
  ["ledgerVersionCount", "2"],
  ["ledgerVersionCount", 3],
  ["secret", "must-not-escape"],
])
  test(`scheduled catalog: reject bad capture ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(
      () => validateScheduledCatalogCapture({ ...capture(), [field]: value }, BASE),
      /upgrade_scheduled_catalog_/u,
    );
  });

for (const [field, value] of [
  ["schema", ""],
  ["name", "unrelated"],
  ["kind", "a"],
  ["identityArguments", null],
  ["result", null],
  ["owner", ""],
  ["language", ""],
  ["securityDefiner", "true"],
  ["strict", null],
  ["leakproof", 0],
  ["returnsSet", "false"],
  ["volatility", "x"],
  ["parallel", "x"],
  ["defaultArgumentCount", -1],
  ["bodyBytes", "42"],
  ["bodySha256", "x".repeat(64)],
  ["definitionSha256", null],
  ["configurationSha256", "a".repeat(63)],
  ["searchPath", ["password=bad"]],
  ["searchPath", ["search_path=public", "search_path=private"]],
  ["extra", 1],
])
  test(`scheduled catalog: reject invalid routine ${field}`, () => {
    const valueCapture = capture();
    valueCapture.routines[0][field] = value;
    assert.throws(
      () => validateScheduledCatalogCapture(valueCapture, BASE),
      /upgrade_scheduled_catalog_/u,
    );
  });

test("scheduled catalog: invalid role grants, ordering and ACL types are rejected", () => {
  const mutations = [
    (r) => r.acl.push(clone(r.acl[0])),
    (r) => {
      r.acl[0].grantable = "false";
    },
    (r) => {
      r.acl[0].privilege = "SELECT";
    },
    (r) => {
      r.acl[0].extra = true;
    },
    (r) => r.effectivePrivileges.reverse(),
    (r) => r.effectivePrivileges.pop(),
    (r) => {
      r.effectivePrivileges[0].execute = "false";
    },
    (r) => {
      r.effectivePrivileges[0].schemaUsage = null;
    },
  ];
  for (const mutate of mutations) {
    const c = capture();
    mutate(c.routines[0]);
    assert.throws(() => validateScheduledCatalogCapture(c, BASE), /upgrade_scheduled_catalog_/u);
  }
});

test("scheduled catalog: exact version and full routine inventories are required", () => {
  for (const versions of [
    [],
    BASE.slice(0, 1),
    [...BASE].reverse(),
    [BASE[0], BASE[0]],
    [BASE[0], "20260823092451"],
  ]) {
    assert.throws(() => validateScheduledCatalogCapture(capture(versions), BASE), /history_/u);
  }
  for (const mutate of [
    (c) => {
      c.routines.pop();
      c.routineCount--;
    },
    (c) => {
      c.routines[0].schema = "private";
    },
    (c) => c.routines.reverse(),
    (c) => {
      c.routines[1] = clone(c.routines[0]);
    },
  ]) {
    const c = capture();
    mutate(c);
    assert.throws(() => validateScheduledCatalogCapture(c, BASE), /upgrade_scheduled_catalog_/u);
  }
});

test("scheduled catalog: later-writer changes are reported without pretending equivalence", () => {
  const upgraded = capture(FINAL);
  upgraded.routines[0].bodySha256 = "f".repeat(64);
  upgraded.routines[0].definitionSha256 = "f".repeat(64);
  upgraded.routines[0].effectivePrivileges[0].execute = true;
  const result = evidence({ upgraded });
  assert.equal(result.routineCatalogMatch, false);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0].fields, [
    "bodySha256",
    "definitionSha256",
    "effectivePrivileges",
  ]);
  assert.equal(result.schemaProofPromoted, false);
  assert.equal(result.productionReleaseReady, false);
});

test("scheduled catalog: extra schemas and overloads are included, not discarded", () => {
  const before = capture();
  before.routines.unshift({ ...row(SCHEDULED_ROUTINE_NAMES[0]), schema: "kova_private" });
  before.routineCount++;
  const upgraded = capture(FINAL);
  upgraded.routines.splice(1, 0, {
    ...row(SCHEDULED_ROUTINE_NAMES[0]),
    identityArguments: "p_id uuid, p_force boolean",
  });
  upgraded.routineCount++;
  const result = evidence({ baseline: before, upgraded });
  assert.deepEqual(result.changes.map((change) => change.kind).sort(), ["added", "removed"]);
  assert.equal(result.baseline.capture.routineCount, 8);
  assert.equal(result.upgraded.capture.routineCount, 8);
});

test("scheduled catalog: bad process output or provenance is fatal", () => {
  for (const value of [null, "", "{}\n{}", "x".repeat(512 * 1024 + 1)])
    assert.throws(() => parseScheduledCatalogCapture(value, BASE), /output_invalid/u);
  for (const value of [null, "main", "d".repeat(39), "d".repeat(40) + "\n"])
    assert.throws(() => evidence({ sourceCommit: value }), /source_invalid/u);
  assert.throws(() => evidence({ sourceTree: null }), /source_invalid/u);
  assert.throws(
    () => evidence({ upgraded: capture(FINAL, "2026-09-19T11:59:59.000Z") }),
    /chronology_invalid/u,
  );
  assert.deepEqual(parseScheduledCatalogCapture(JSON.stringify(capture()), BASE), capture());
});

test("scheduled catalog: query is bounded and calls no application routine", () => {
  assert.match(
    SCHEDULED_CATALOG_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(SCHEDULED_CATALOG_SQL, /statement_timeout = '10s'/u);
  assert.match(SCHEDULED_CATALOG_SQL, /lock_timeout = '1s'/u);
  assert.match(SCHEDULED_CATALOG_SQL, /search_path = pg_catalog/u);
  assert.match(SCHEDULED_CATALOG_SQL, /has_schema_privilege/u);
  assert.match(SCHEDULED_CATALOG_SQL, /has_function_privilege/u);
  assert.match(SCHEDULED_CATALOG_SQL, /acldefault/u);
  assert.match(SCHEDULED_CATALOG_SQL, /pg_get_functiondef/u);
  assert.doesNotMatch(
    SCHEDULED_CATALOG_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy)\b/iu,
  );
  for (const name of SCHEDULED_ROUTINE_NAMES)
    assert.doesNotMatch(
      SCHEDULED_CATALOG_SQL,
      new RegExp(`(?:public|kova_private)\\.${name}\\s*\\(`, "u"),
    );
  assert.doesNotMatch(SCHEDULED_CATALOG_SQL, /from\s+(?:public|auth|storage|vault)\./iu);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kova-scheduled-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    "supabase/migrations",
    dirname(MANIFEST),
    "scripts/release",
    "node_modules/.bin",
    "artifacts/release",
  ])
    mkdirSync(join(root, path), { recursive: true });
  cpSync(join(ROOT, "supabase/migrations"), join(root, "supabase/migrations"), { recursive: true });
  cpSync(join(ROOT, dirname(MANIFEST)), join(root, dirname(MANIFEST)), { recursive: true });
  for (const name of ["upgrade-database-seed.sql", "upgrade-database-assertions.sql"])
    cpSync(join(ROOT, "scripts/release", name), join(root, "scripts/release", name));
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mock");
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
function mock(data, hook = () => null) {
  const calls = [];
  let counter = 0;
  return {
    calls,
    execute(command, args, options) {
      const call = { command, args, ...options };
      calls.push(call);
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(
        !args.includes("--linked") && !args.includes("--db-url") && !args.includes("repair"),
      );
      if (options.input === SCHEDULED_CATALOG_SQL) {
        counter++;
        assert.equal(command, "docker");
        for (const flag of ["-A", "-t", "-q", "ON_ERROR_STOP=1"]) assert.ok(args.includes(flag));
        return (
          hook(call, counter) ?? {
            status: 0,
            stdout: JSON.stringify(capture(counter === 1 ? data.before : data.after)),
            stderr: "",
          }
        );
      }
      return (
        hook(call, 0) ?? {
          status: 0,
          stdout:
            command === "git"
              ? args.includes("status")
                ? ""
                : (args.at(-1) === "HEAD^{tree}" ? "e" : "d").repeat(40)
              : "",
          stderr: "",
        }
      );
    },
  };
}

test("scheduled catalog: real plan binds two checkpoints, actual history and artifact bytes", (t) => {
  const data = fixture(t);
  const runner = mock(data, () => {
    assert.equal(existsSync(join(data.root, "artifacts/release", SCHEDULED_CATALOG_FILE)), false);
    return null;
  });
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureScheduledCatalog: true,
    execute: runner.execute,
  });
  const bytes = readFileSync(join(data.root, "artifacts/release", SCHEDULED_CATALOG_FILE));
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.baseline.capture.ledgerVersionCount, 98);
  assert.equal(receipt.upgraded.capture.ledgerVersionCount, 181);
  assert.equal(result.forwardMigrations.length, 83);
  assert.equal(result.scheduledCatalog.sha256, sha256(bytes));
  assert.equal(result.scheduledCatalog.querySha256, receipt.querySha256);
  assert.equal(result.sourceCommit, receipt.sourceCommit);
  assert.equal(receipt.sourceTree, "e".repeat(40));
  assert.equal(receipt.schemaProofPromoted, false);
  const sql = runner.calls.filter((c) => c.command === "docker").map((c) => c.input);
  assert.match(sql[0], /upgrade_baseline_history_mismatch/u);
  assert.equal(sql[1], SCHEDULED_CATALOG_SQL);
  assert.match(sql[2], /Synthetic fixtures/u);
  assert.match(sql.at(-2), /upgrade_final_history_mismatch/u);
  assert.equal(sql.at(-1), SCHEDULED_CATALOG_SQL);
  assert.equal(runner.calls.at(-1).args[0], "stop");
  assert.equal(existsSync(runner.calls[0].cwd), false);
});

for (const failAt of [1, 2])
  test(`scheduled catalog: invalid checkpoint ${failAt} blocks success and cleans up`, (t) => {
    const data = fixture(t);
    for (const name of ["upgrade-database.json", SCHEDULED_CATALOG_FILE])
      writeFileSync(join(data.root, "artifacts/release", name), '{"passed":true}');
    const runner = mock(data, (_call, n) =>
      n === failAt ? { status: 0, stdout: "{}", stderr: "" } : null,
    );
    assert.throws(
      () =>
        rehearseUpgrade({
          root: data.root,
          currentHistory: true,
          captureScheduledCatalog: true,
          execute: runner.execute,
        }),
      /shape_invalid/u,
    );
    for (const name of ["upgrade-database.json", SCHEDULED_CATALOG_FILE])
      assert.equal(existsSync(join(data.root, "artifacts/release", name)), false);
    assert.equal(runner.calls.at(-1).args[0], "stop");
    if (failAt === 1)
      assert.equal(
        runner.calls.some((c) => c.args[0] === "migration"),
        false,
      );
    assert.equal(existsSync(runner.calls[0].cwd), false);
  });

test("scheduled catalog: failed cleanup cannot publish captures", (t) => {
  const data = fixture(t);
  const runner = mock(data, (call) =>
    call.args[0] === "stop" ? { status: 1, stdout: "", stderr: "failed" } : null,
  );
  assert.throws(
    () =>
      rehearseUpgrade({
        root: data.root,
        currentHistory: true,
        captureScheduledCatalog: true,
        execute: runner.execute,
      }),
    /cleanup_failed/u,
  );
  for (const name of ["upgrade-database.json", SCHEDULED_CATALOG_FILE])
    assert.equal(existsSync(join(data.root, "artifacts/release", name)), false);
});

test("scheduled catalog: preflight clears stale proof; dry-run leaves files and database untouched", (t) => {
  const data = fixture(t);
  const path = join(data.root, "artifacts/release", SCHEDULED_CATALOG_FILE);
  writeFileSync(path, "old");
  const execute = () => assert.fail("must not execute");
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureScheduledCatalog: true,
    dryRun: true,
    execute,
  });
  assert.equal(result.executed, false);
  assert.equal(result.scheduledCatalogPlanned, true);
  assert.equal(readFileSync(path, "utf8"), "old");
  assert.throws(
    () =>
      rehearseUpgrade({ root: data.root, captureScheduledCatalog: true, dryRun: true, execute }),
    /current_history_required/u,
  );
  assert.equal(readFileSync(path, "utf8"), "old");
  assert.throws(
    () => rehearseUpgrade({ root: data.root, captureScheduledCatalog: true, execute }),
    /current_history_required/u,
  );
  assert.equal(existsSync(path), false);
});

test("scheduled catalog: adds no production authority or formal lineage promotion", () => {
  const lineage = JSON.parse(readFileSync(join(ROOT, "release-migration-lineage.json")));
  assert.equal(lineage.entries.filter((r) => r.status === "requires_schema_proof").length, 19);
  for (const version of BASE)
    assert.equal(
      lineage.entries.find((r) => r.remoteVersion === version).status,
      "requires_schema_proof",
    );
});

test("scheduled catalog: both collectors coexist and link independent artifacts", async (t) => {
  const { TEMP_EXPORT_CATALOG_SQL, TEMP_EXPORT_PROOF_FILE } =
    await import("../../scripts/release/upgrade-database-temp-export-proof.mjs");
  const data = fixture(t);
  let temporaryCount = 0;
  const runner = mock(data, (call) => {
    if (call.input !== TEMP_EXPORT_CATALOG_SQL) return null;
    temporaryCount++;
    const versions = temporaryCount === 1 ? data.before : data.after;
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        captureKind: "temporary-export-catalog-absence",
        capturedAt: "2026-09-19T12:00:00.000Z",
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
        ledgerVersionCount: versions.length,
        ledgerVersions: versions,
      }),
      stderr: "",
    };
  });
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureTemporaryExport: true,
    captureScheduledCatalog: true,
    execute: runner.execute,
  });
  assert.equal(temporaryCount, 2);
  for (const [field, file] of [
    ["temporaryExportProof", TEMP_EXPORT_PROOF_FILE],
    ["scheduledCatalog", SCHEDULED_CATALOG_FILE],
  ]) {
    const bytes = readFileSync(join(data.root, "artifacts/release", file));
    const receipt = JSON.parse(bytes);
    assert.equal(result[field].sha256, sha256(bytes));
    assert.equal(receipt.sourceCommit, result.sourceCommit);
    assert.equal(receipt.sourceTree, "e".repeat(40));
    assert.equal(receipt.schemaProofPromoted, false);
  }
  const input = runner.calls.filter((call) => call.command === "docker").map((call) => call.input);
  assert.equal(input.length, 8);
  assert.equal(input[1], TEMP_EXPORT_CATALOG_SQL);
  assert.equal(input[2], SCHEDULED_CATALOG_SQL);
  assert.equal(input.at(-2), TEMP_EXPORT_CATALOG_SQL);
  assert.equal(input.at(-1), SCHEDULED_CATALOG_SQL);
  assert.equal(
    runner.calls.filter((call) => call.command === "git" && call.args.at(-1) === "HEAD^{tree}")
      .length,
    1,
  );
});
