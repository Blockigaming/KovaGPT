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
  planUpgrade,
  rehearseUpgrade as actualRehearseUpgrade,
  MANIFEST,
} from "../../scripts/release/upgrade-database.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import {
  TEMP_EXPORT_CATALOG_SQL,
  TEMP_EXPORT_PROOF_FILE,
  TEMP_EXPORT_QUERY_SHA256,
  buildTemporaryExportProof,
  parseTemporaryExportCapture,
  temporaryExportSnapshot,
  validateTemporaryExportCapture,
} from "../../scripts/release/upgrade-database-temp-export-proof.mjs";

// Database orchestration is mocked here; real Git/source checks have their own suite.
const rehearseUpgrade = (options = {}) =>
  actualRehearseUpgrade({
    inspectSource: () => ({
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      trackedFileCount: 1,
      readFile: readFileSync,
      readDirectory: readdirSync,
    }),
    ...options,
  });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = ["20260824085042", "20260906024459"];
const FINAL = [...BASE, "20260907120000"];
const sourceCommit = "a".repeat(40);
const sourceTree = "b".repeat(40);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function capture(versions = BASE, capturedAt = "2026-09-18T10:00:00.000Z") {
  return {
    schemaVersion: 1,
    captureKind: "temporary-export-catalog-absence",
    capturedAt,
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
    ledgerVersions: [...versions],
  };
}

function proof(overrides = {}) {
  return buildTemporaryExportProof({
    baseline: capture(),
    upgraded: capture(FINAL, "2026-09-18T10:01:00.000Z"),
    baselineVersions: BASE,
    finalVersions: FINAL,
    sourceCommit,
    sourceTree,
    ...overrides,
  });
}

test("temporary export: scoped fingerprints exclude checkpoint metadata without discarding provenance", () => {
  const result = proof();
  assert.deepEqual(result.baseline.fingerprint, result.upgraded.fingerprint);
  assert.notEqual(result.baseline.ledgerVersionsSha256, result.upgraded.ledgerVersionsSha256);
  assert.notEqual(result.baseline.capture.capturedAt, result.upgraded.capture.capturedAt);
  assert.equal(Object.keys(result.baseline.fingerprint).length, 4);
  assert.equal(result.querySha256, hash(TEMP_EXPORT_CATALOG_SQL));
  assert.equal(result.querySha256, TEMP_EXPORT_QUERY_SHA256);
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.sourceTree, sourceTree);
  assert.equal(result.isolatedFingerprintMatch, true);
  for (const key of [
    "liveCatalogCompared",
    "schemaProofPromoted",
    "canonicalHistoryReconciled",
    "productionReleaseReady",
    "productionRowsRestored",
  ])
    assert.equal(result[key], false);
  assert.match(result.limitations.join(" "), /dynamically constructed references/u);
  assert.match(result.limitations.join(" "), /No fresh-source checkpoint/u);
});

test("temporary export: caller mutations cannot rewrite a previously validated receipt", () => {
  const value = capture();
  const validated = validateTemporaryExportCapture(value, BASE);
  value.ledgerVersions.push("20260907120000");
  assert.deepEqual(validated.ledgerVersions, BASE);
});

for (const [field, value] of [
  ["schemaVersion", "1"],
  ["captureKind", "unverified"],
  ["capturedAt", "invalid"],
  ["capturedAt", "2026-02-30T10:00:00.000Z"],
  ["capturedAt", "2026-09-18T10:00:00Z"],
  ["postgresVersionNum", "170006"],
  ["postgresVersionNum", 160006],
  ["postgresVersionNum", 180006],
  ["databaseName", "wrong_database"],
  ["readOnly", false],
  ["readOnly", "true"],
  ["isolation", "read committed"],
  ["publicSchemaPresent", false],
  ["catalogSentinelPresent", false],
  ["ledgerVersionCount", "2"],
  ["unrequested_secret_field", "do-not-persist"],
]) {
  test(`temporary export: invalid ${field} (${JSON.stringify(value)}) is rejected`, () => {
    assert.throws(
      () => validateTemporaryExportCapture({ ...capture(), [field]: value }, BASE),
      /upgrade_temp_export_capture_invalid/u,
    );
  });
}

for (const [field, value] of [
  ["exactSignaturePresent", true],
  ["exactSignaturePresent", "false"],
  ["routineFamilyCount", 1],
  ["routineFamilyCount", "0"],
  ["routineFamilyCount", null],
  ["inboundDependencyCount", 1],
  ["inboundDependencyCount", -1],
  ["storedReferenceCount", 1],
  ["storedReferenceCount", "0"],
]) {
  test(`temporary export: ${field} cannot be silently normalized to absence`, () => {
    assert.throws(
      () => validateTemporaryExportCapture({ ...capture(), [field]: value }, BASE),
      /absence_not_proven/u,
    );
  });
}

test("temporary export: missing counters, empty output, and truncated output are not evidence", () => {
  const value = capture();
  delete value.routineFamilyCount;
  assert.throws(() => validateTemporaryExportCapture(value, BASE), /capture_invalid/u);
  for (const stdout of ["", "BEGIN\n{}\nCOMMIT", "{}\n{}", "x".repeat(65537), null])
    assert.throws(() => parseTemporaryExportCapture(stdout, BASE), /output_invalid/u);
  assert.deepEqual(parseTemporaryExportCapture(JSON.stringify(capture()) + "\n", BASE), capture());
});

test("temporary export: every observed ledger version must match, not just its count", () => {
  for (const versions of [
    [...BASE].reverse(),
    [BASE[0], BASE[0]],
    [BASE[0]],
    [BASE[0], "20260906024458"],
    ["20260906024459"],
    [],
  ])
    assert.throws(() => validateTemporaryExportCapture(capture(versions), BASE), /history_/u);
  assert.throws(
    () => validateTemporaryExportCapture({ ...capture(), ledgerVersionCount: 3 }, BASE),
    /history_mismatch/u,
  );
  assert.throws(
    () => validateTemporaryExportCapture(capture(["20260906024459"]), ["20260906024459"]),
    /history_mismatch/u,
  );
  for (const expected of [null, [], [42], [BASE[0], BASE[0]], Array(2001).fill(BASE[0])])
    assert.throws(() => validateTemporaryExportCapture(capture(), expected), /history_invalid/u);
});

test("temporary export: source labels and backwards checkpoint time cannot pass", () => {
  for (const value of [undefined, "main", "a".repeat(39), 1e39, "a".repeat(40) + "\n"])
    assert.throws(() => proof({ sourceCommit: value }), /source_invalid/u);
  assert.throws(() => proof({ sourceTree: null }), /source_invalid/u);
  assert.throws(
    () => proof({ upgraded: capture(FINAL, "2026-09-18T09:59:59.999Z") }),
    /comparison_invalid/u,
  );
});

test("temporary export: SQL reads only catalog and ledger metadata with fail-closed isolation", () => {
  assert.match(
    TEMP_EXPORT_CATALOG_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(TEMP_EXPORT_CATALOG_SQL, /set local statement_timeout = '10s'/u);
  assert.match(TEMP_EXPORT_CATALOG_SQL, /set local lock_timeout = '1s'/u);
  assert.match(TEMP_EXPORT_CATALOG_SQL, /set local search_path = pg_catalog/u);
  assert.match(
    TEMP_EXPORT_CATALOG_SQL,
    /where lower\(p.proname::text\) = '_kova_temp_export_day15'/u,
  );
  assert.match(
    TEMP_EXPORT_CATALOG_SQL,
    /strpos\(lower\(p.prosrc\), '_kova_temp_export_day15'\) > 0/u,
  );
  assert.doesNotMatch(
    TEMP_EXPORT_CATALOG_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|pg_sleep|dblink|http_post)\b/iu,
  );
  assert.doesNotMatch(
    TEMP_EXPORT_CATALOG_SQL,
    /(?:public|auth|storage|vault)\.(?:users|objects|secrets|decrypted_secrets)/iu,
  );
  assert.doesNotMatch(
    TEMP_EXPORT_CATALOG_SQL,
    /pg_get_functiondef|statements|password|proconfig/iu,
  );
  assert.ok(TEMP_EXPORT_CATALOG_SQL.endsWith("commit;"));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kova-temp-export-proof-test-"));
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
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mocked executable");
  const plan = extendCurrentHistory(
    planUpgrade(root),
    readFileSync(join(root, CURRENT_HISTORY_SNAPSHOT)),
  );
  return {
    root,
    before: plan.baseline.map((row) => row.version).sort(),
    after: [...plan.baseline, ...plan.executionForward].map((row) => row.version).sort(),
  };
}

function executor(data, hook = () => null) {
  const calls = [];
  let captureNumber = 0;
  return {
    calls,
    execute(command, args, options) {
      const call = { command, args, ...options };
      calls.push(call);
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(
        !args.includes("--linked") && !args.includes("--db-url") && !args.includes("repair"),
      );
      if (options.input === TEMP_EXPORT_CATALOG_SQL) {
        captureNumber++;
        assert.equal(command, "docker");
        for (const flag of ["-A", "-t", "-q", "ON_ERROR_STOP=1"]) assert.ok(args.includes(flag));
        const result = hook(call, captureNumber);
        if (result) return result;
        return {
          status: 0,
          stdout: JSON.stringify(
            capture(
              captureNumber === 1 ? data.before : data.after,
              captureNumber === 1 ? "2026-09-18T10:00:00.000Z" : "2026-09-18T10:01:00.000Z",
            ),
          ),
          stderr: "",
        };
      }
      return (
        hook(call, 0) ?? {
          status: 0,
          stdout:
            command === "git"
              ? args.includes("status")
                ? ""
                : args.at(-1) === "HEAD^{tree}"
                  ? sourceTree
                  : sourceCommit
              : "",
          stderr: "",
        }
      );
    },
  };
}

test("temporary export: real source plan captures both checkpoints and writes linked evidence only after cleanup", (t) => {
  const data = fixture(t);
  const runner = executor(data, (call) => {
    assert.equal(existsSync(join(data.root, "artifacts/release", TEMP_EXPORT_PROOF_FILE)), false);
    return null;
  });
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureTemporaryExport: true,
    execute: runner.execute,
  });
  const bytes = readFileSync(join(data.root, "artifacts/release", TEMP_EXPORT_PROOF_FILE));
  const record = JSON.parse(bytes);
  assert.equal(record.baseline.capture.ledgerVersionCount, 98);
  assert.ok(result.forwardMigrations.length > 0);
  assert.equal(
    record.upgraded.capture.ledgerVersionCount,
    record.baseline.capture.ledgerVersionCount + result.forwardMigrations.length,
  );
  assert.equal(result.temporaryExportProof.sha256, hash(bytes));
  assert.equal(result.temporaryExportProof.querySha256, record.querySha256);
  assert.equal(result.sourceCommit, record.sourceCommit);
  assert.equal(record.sourceTree, sourceTree);
  assert.deepEqual(record.baseline.fingerprint, record.upgraded.fingerprint);
  assert.equal(record.schemaProofPromoted, false);
  const inputs = runner.calls.filter((call) => call.command === "docker").map((call) => call.input);
  assert.equal(inputs.length, 6);
  assert.match(inputs[0], /upgrade_baseline_history_mismatch/u);
  assert.equal(inputs[1], TEMP_EXPORT_CATALOG_SQL);
  assert.match(inputs[2], /Synthetic fixtures/u);
  assert.match(inputs[4], /upgrade_final_history_mismatch/u);
  assert.equal(inputs[5], TEMP_EXPORT_CATALOG_SQL);
  assert.equal(runner.calls.at(-1).args[0], "stop");
  assert.equal(existsSync(runner.calls[0].cwd), false);
});

test("temporary export: dirty source is rejected before any database operation", (t) => {
  const data = fixture(t);
  const runner = executor(data);
  assert.throws(
    () =>
      rehearseUpgrade({
        root: data.root,
        currentHistory: true,
        captureTemporaryExport: true,
        inspectSource: () => {
          throw new Error("upgrade_source_worktree_dirty");
        },
        execute: runner.execute,
      }),
    /source_worktree_dirty/u,
  );
  for (const name of ["upgrade-database.json", TEMP_EXPORT_PROOF_FILE])
    assert.equal(existsSync(join(data.root, "artifacts/release", name)), false);
  assert.equal(runner.calls.length, 0);
});

for (const failAt of [1, 2]) {
  test(`temporary export: absence failure at checkpoint ${failAt} fails rehearsal and leaves no success files`, (t) => {
    const data = fixture(t);
    const directory = join(data.root, "artifacts/release");
    for (const name of ["upgrade-database.json", TEMP_EXPORT_PROOF_FILE])
      writeFileSync(join(directory, name), '{"passed":true}');
    const runner = executor(data, (_call, captureNumber) =>
      captureNumber === failAt
        ? {
            status: 0,
            stdout: JSON.stringify({
              ...capture(captureNumber === 1 ? data.before : data.after),
              routineFamilyCount: 1,
            }),
            stderr: "",
          }
        : null,
    );
    assert.throws(
      () =>
        rehearseUpgrade({
          root: data.root,
          currentHistory: true,
          captureTemporaryExport: true,
          execute: runner.execute,
        }),
      /absence_not_proven/u,
    );
    for (const name of ["upgrade-database.json", TEMP_EXPORT_PROOF_FILE])
      assert.equal(existsSync(join(directory, name)), false);
    assert.equal(runner.calls.at(-1).args[0], "stop");
    if (failAt === 1)
      assert.equal(
        runner.calls.some((call) => call.args[0] === "migration"),
        false,
      );
    assert.equal(existsSync(runner.calls[0].cwd), false);
  });
}

test("temporary export: cleanup failure discards successful in-memory captures", (t) => {
  const data = fixture(t);
  const runner = executor(data, (call) =>
    call.args[0] === "stop" ? { status: 1, stdout: "", stderr: "synthetic cleanup failure" } : null,
  );
  assert.throws(
    () =>
      rehearseUpgrade({
        root: data.root,
        currentHistory: true,
        captureTemporaryExport: true,
        execute: runner.execute,
      }),
    /cleanup_failed/u,
  );
  for (const name of ["upgrade-database.json", TEMP_EXPORT_PROOF_FILE])
    assert.equal(existsSync(join(data.root, "artifacts/release", name)), false);
});

test("temporary export: proof-enabled dry-run is observational; unsupported historical mode rejects", (t) => {
  const data = fixture(t);
  const path = join(data.root, "artifacts/release", TEMP_EXPORT_PROOF_FILE);
  writeFileSync(path, "previous-proof");
  const execute = () => assert.fail("dry-run must not execute");
  const result = rehearseUpgrade({
    root: data.root,
    currentHistory: true,
    captureTemporaryExport: true,
    dryRun: true,
    execute,
  });
  assert.equal(result.executed, false);
  assert.equal(result.temporaryExportProofPlanned, true);
  assert.equal(result.temporaryExportQuerySha256, TEMP_EXPORT_QUERY_SHA256);
  assert.equal(readFileSync(path, "utf8"), "previous-proof");
  assert.throws(
    () => rehearseUpgrade({ root: data.root, captureTemporaryExport: true, dryRun: true, execute }),
    /current_history_required/u,
  );
  assert.equal(readFileSync(path, "utf8"), "previous-proof");
});

test("temporary export: historical fixture remains a drop and current source contains no symbol reference", () => {
  const historical = readFileSync(
    join(ROOT, dirname(MANIFEST), "20260824085042_remove_temporary_day15_source_export.sql"),
    "utf8",
  );
  assert.match(historical, /drop function if exists public\._kova_temp_export_day15\(text\)/u);
  const references = readdirSync(join(ROOT, "supabase/migrations")).filter(
    (name) =>
      /\.sql$/u.test(name) &&
      readFileSync(join(ROOT, "supabase/migrations", name), "utf8")
        .toLowerCase()
        .includes("_kova_temp_export_day15"),
  );
  assert.deepEqual(references, []);
  const lineage = JSON.parse(readFileSync(join(ROOT, "release-migration-lineage.json")));
  assert.equal(
    lineage.entries.filter((entry) => entry.status === "requires_schema_proof").length,
    19,
  );
  assert.equal(
    lineage.entries.find((entry) => entry.remoteVersion === "20260824085042").status,
    "requires_schema_proof",
  );
});
