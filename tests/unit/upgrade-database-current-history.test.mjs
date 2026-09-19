import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
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
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
  ledgerMetadataHash,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import { MANIFEST, planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (name, value) => createHash(name).update(value).digest("hex");
const sourceName = "20260903145843_remediate_security_advisor_warnings.sql";
const remoteName = "20260906024459_remediate_security_advisor_warnings.sql";
const actualSnapshot = readFileSync(join(ROOT, CURRENT_HISTORY_SNAPSHOT));

function syntheticPlan() {
  const content = Buffer.from("select 1;\n");
  const baseline = Array.from({ length: 97 }, (_, index) => {
    const version = String(20260601000000 + index);
    const origin = index < 74 ? "matched_source" : "reviewed_structural_fixture";
    const directory = index < 74 ? "supabase/migrations" : dirname(MANIFEST);
    return {
      version,
      path: `${directory}/${version}_synthetic.sql`,
      sha256: hash("sha256", content),
      capturedStatementsSha256: hash("sha256", content),
      capturedStatementsMd5: hash("md5", content),
      statementCount: index === 96 ? 946 : 1,
      origin,
      content,
    };
  });
  const manifest = {
    schemaVersion: 1,
    productionVersionCount: 97,
    migrations: baseline.map(({ content: _content, ...metadata }) => metadata),
  };
  const forward = [
    {
      name: sourceName,
      version: "20260903145843",
      sha256: hash("sha256", content),
      content,
    },
  ];
  const plan = {
    manifest,
    baseline,
    baselineSha256: hash("sha256", JSON.stringify(manifest)),
    pending: [sourceName],
    forward,
  };
  const snapshot = JSON.parse(actualSnapshot);
  snapshot.historicalManifestSha256 = plan.baselineSha256;
  snapshot.historicalLedgerSha256 = ledgerMetadataHash(baseline);
  snapshot.supplement[0].statementBytes = content.length;
  snapshot.supplement[0].capturedStatementsSha256 = hash("sha256", content);
  snapshot.supplement[0].capturedStatementsMd5 = hash("md5", content);
  return { plan, snapshot };
}

function extend(plan, snapshot) {
  return extendCurrentHistory(plan, Buffer.from(JSON.stringify(snapshot)));
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kova-current-history-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { plan, snapshot } = syntheticPlan();
  for (const path of [
    "supabase/migrations",
    dirname(MANIFEST),
    "scripts/release",
    "node_modules/.bin",
  ])
    mkdirSync(join(root, path), { recursive: true });
  for (const row of plan.baseline) writeFileSync(join(root, row.path), row.content);
  writeFileSync(join(root, MANIFEST), JSON.stringify(plan.manifest));
  writeFileSync(join(root, CURRENT_HISTORY_SNAPSHOT), JSON.stringify(snapshot));
  writeFileSync(join(root, "supabase/migrations", sourceName), plan.forward[0].content);
  writeFileSync(join(root, "scripts/release/upgrade-database-seed.sql"), "select 1; -- synthetic");
  writeFileSync(join(root, "scripts/release/upgrade-database-assertions.sql"), "select 1;");
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mock local CLI");
  return root;
}

test("current snapshot core: executes equivalent SQL once without fabricated history", () => {
  const { plan, snapshot } = syntheticPlan();
  const result = extend(plan, snapshot);
  assert.equal(plan.baseline.length, 97);
  assert.equal(result.baseline.length, 98);
  assert.equal(result.baseline.at(-1).replayName, remoteName);
  assert.equal(result.baseline.at(-1).content, plan.forward[0].content);
  assert.equal(result.forward, plan.forward);
  assert.equal(result.pending, plan.pending);
  assert.equal(result.executionForward.length, 0);
  assert.equal(result.currentHistory.requiresCanonicalHistoryReconciliation, true);
  assert.equal(result.currentHistory.productionReleaseReady, false);
  assert.equal(result.currentHistory.contentEquivalentBaselines[0].sourceVersion, "20260903145843");
  assert.equal(result.currentHistory.baselineStatementCount, 1043);
  assert.equal(result.currentHistory.productionRowsRestored, false);
  assert.equal(result.currentHistory.liveCatalogEquivalenceProven, false);
  assert.match(result.currentHistory.supplementSha256, /^[a-f0-9]{64}$/u);
});

for (const [name, path, value] of [
  ["wrong project", "projectRef", "wrong-project"],
  ["coerced current count", "currentVersionCount", "98"],
  ["wrong baseline count", "historicalVersionCount", 96],
  ["wrong total statements", "currentStatementCount", 1044],
  ["invalid capture time", "capturedAt", "invalid"],
  ["missing read-only flag", "readOnly", undefined],
  ["coerced false flag", "customerRowsReturned", "false"],
  ["multiple supplements", "supplement", [{}, {}]],
  ["wrong manifest hash", "historicalManifestSha256", "a".repeat(64)],
  ["wrong ledger hash", "historicalLedgerSha256", "b".repeat(64)],
  ["source traversal", "supplement.0.sourcePath", "../outside.sql"],
  ["wrong remote version", "supplement.0.remoteVersion", "20260906024458"],
  ["wrong source version", "supplement.0.sourceVersion", "20260903145842"],
  ["unsafe name", "supplement.0.name", "../escape"],
  ["multiple statements", "supplement.0.statementCount", 2],
  ["coerced byte count", "supplement.0.statementBytes", "10"],
  ["wrong source hash", "supplement.0.capturedStatementsSha256", "c".repeat(64)],
  ["wrong source MD5", "supplement.0.capturedStatementsMd5", "d".repeat(32)],
  ["unproven comparison", "supplement.0.comparison", "name-only"],
]) {
  test(`current snapshot core: rejects ${name}`, () => {
    const { plan, snapshot } = syntheticPlan();
    const keys = path.split(".");
    const property = keys.pop();
    const target = keys.reduce((object, key) => object[key], snapshot);
    target[property] = value;
    assert.throws(() => extend(plan, snapshot), /upgrade_current_history_/u);
  });
}

test("current snapshot core: rejects source tampering even with matching declared SHA", () => {
  const { plan, snapshot } = syntheticPlan();
  plan.forward[0].content = Buffer.from("select 2;\n");
  assert.throws(() => extend(plan, snapshot), /upgrade_current_history_source_mismatch/u);
});

test("current snapshot core: rejects missing or duplicate canonical source", () => {
  for (const count of [0, 2]) {
    const { plan, snapshot } = syntheticPlan();
    plan.forward = Array(count).fill(plan.forward[0]);
    assert.throws(() => extend(plan, snapshot), /upgrade_current_history_source_missing/u);
  }
});

test("current snapshot core: rejects remote version already in forward", () => {
  const { plan, snapshot } = syntheticPlan();
  plan.forward.push({ ...plan.forward[0], version: "20260906024459" });
  assert.throws(() => extend(plan, snapshot), /upgrade_current_history_supplement_invalid/u);
});

test("current snapshot core: metadata hashing rejects duplicate or unordered versions", () => {
  const { plan } = syntheticPlan();
  assert.throws(() => ledgerMetadataHash([...plan.baseline].reverse()), /metadata_invalid/u);
  assert.throws(
    () => ledgerMetadataHash([plan.baseline[0], plan.baseline[0]]),
    /metadata_invalid/u,
  );
});

test("current snapshot core: historical metadata changes invalidate receipt", () => {
  const { plan, snapshot } = syntheticPlan();
  plan.baseline[0].capturedStatementsMd5 = "e".repeat(32);
  assert.throws(() => extend(plan, snapshot), /historical_drift/u);
});

test("current snapshot core: dry-run selects 98 without executing anything", (t) => {
  const root = fixture(t);
  const result = rehearseUpgrade({
    root,
    currentHistory: true,
    dryRun: true,
    execute: () => assert.fail("dry-run must not execute"),
  });
  assert.equal(result.baselineVersions, 98);
  assert.equal(result.executed, false);
  assert.deepEqual(result.pendingVersions, ["20260903145843"]);
  assert.deepEqual(result.replayPendingVersions, []);
  assert.equal(result.currentHistory.requiresCanonicalHistoryReconciliation, true);
  assert.equal(rehearseUpgrade({ root, dryRun: true }).baselineVersions, 97);
});

test("current snapshot core: bad receipt fails before executing a local command", (t) => {
  const root = fixture(t);
  const path = join(root, CURRENT_HISTORY_SNAPSHOT);
  const snapshot = JSON.parse(readFileSync(path));
  snapshot.currentVersionCount = 99;
  writeFileSync(path, JSON.stringify(snapshot));
  assert.throws(
    () =>
      rehearseUpgrade({
        root,
        currentHistory: true,
        execute: () => assert.fail("invalid receipt must not execute"),
      }),
    /upgrade_current_history_snapshot_invalid/u,
  );
});

test("current snapshot core: mocked rehearsal confines alias to disposable project", (t) => {
  const root = fixture(t);
  const key = "KOVA_PRODUCTION_DATABASE_URL";
  const original = process.env[key];
  process.env[key] = "synthetic-do-not-propagate";
  t.after(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
  let project;
  const sql = [];
  const result = rehearseUpgrade({
    root,
    currentHistory: true,
    execute(command, args, options) {
      project = options.cwd;
      assert.notEqual(project, root);
      assert.equal(options.env[key], undefined);
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(!args.includes("--linked"));
      assert.ok(!args.includes("--db-url"));
      const dir = join(project, "supabase/migrations");
      if (args[0] === "start" || args[0] === "db") {
        assert.equal(readdirSync(dir).length, 98);
        assert.ok(existsSync(join(dir, remoteName)));
        assert.ok(!existsSync(join(dir, sourceName)));
      }
      if (args[0] === "migration") {
        assert.equal(readdirSync(dir).length, 98);
        assert.ok(!existsSync(join(dir, sourceName)));
        assert.ok(existsSync(join(dir, remoteName)));
      }
      if (command === "docker") sql.push(options.input);
      return {
        status: 0,
        stdout: command === "git" && args.includes("rev-parse") ? "a".repeat(40) : "",
        stderr: "",
      };
    },
  });
  assert.equal(result.baselineVersions, 98);
  assert.match(sql[0], /20260906024459/u);
  assert.doesNotMatch(sql[0], /20260903145843/u);
  assert.match(sql.at(-1), /20260906024459/u);
  assert.doesNotMatch(sql.at(-1), /20260903145843/u);
  assert.deepEqual(result.forwardMigrations, []);
  assert.deepEqual(result.pendingVersions, ["20260903145843"]);
  assert.equal(result.currentHistory.productionReleaseReady, false);
  assert.ok(!existsSync(join(root, "supabase/migrations", remoteName)));
  assert.ok(!existsSync(project));
  assert.equal(result.currentHistory.productionRowsRestored, false);
});

test("current snapshot core: CLI defaults to 98 with explicit historical opt-out", (t) => {
  const root = fixture(t);
  for (const name of [
    "upgrade-database.mjs",
    "upgrade-database-current-history.mjs",
    "upgrade-database-temp-export-proof.mjs",
    "upgrade-database-scheduled-catalog.mjs",
    "migration-schema-fingerprint.mjs",
  ])
    writeFileSync(
      join(root, "scripts/release", name),
      readFileSync(join(ROOT, "scripts/release", name)),
    );
  const command = join(root, "scripts/release/upgrade-database.mjs");
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, [command, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
      }),
    );
  assert.equal(run(["--dry-run"]).baselineVersions, 98);
  assert.equal(run(["--dry-run"]).executed, false);
  assert.equal(run(["--historical-baseline", "--dry-run"]).baselineVersions, 97);
});

test("current snapshot source: validates the actual captured baseline and source hashes", () => {
  const historical = planUpgrade();
  const plan = extendCurrentHistory(historical, actualSnapshot);
  assert.equal(plan.baseline.length, 98);
  assert.equal(plan.currentHistory.baselineStatementCount, 1043);
  assert.equal(plan.baseline.at(-1).version, "20260906024459");
  assert.ok(plan.forward.some((row) => row.version === "20260903145843"));
  assert.ok(!plan.executionForward.some((row) => row.version === "20260903145843"));
  assert.equal(plan.executionForward.length, plan.forward.length - 1);
});

function staleEvidence(root) {
  const directory = join(root, "artifacts/release");
  mkdirSync(directory, { recursive: true });
  const success = join(directory, "upgrade-database.json");
  const failure = join(directory, "upgrade-failure.log");
  writeFileSync(success, '{"passed":true,"baselineVersions":97}');
  writeFileSync(failure, "previous failure");
  return { success, failure };
}

for (const [name, change, expected] of [
  [
    "invalid supplemented count",
    (root) => {
      const path = join(root, CURRENT_HISTORY_SNAPSHOT);
      const value = JSON.parse(readFileSync(path));
      value.currentVersionCount = 99;
      writeFileSync(path, JSON.stringify(value));
    },
    /upgrade_current_history_snapshot_invalid/u,
  ],
  [
    "invalid historical manifest",
    (root) => writeFileSync(join(root, MANIFEST), '{"schemaVersion":0}'),
    /upgrade_baseline_manifest_invalid/u,
  ],
  [
    "malformed receipt JSON",
    (root) => writeFileSync(join(root, CURRENT_HISTORY_SNAPSHOT), "do-not-log-this-sentinel"),
    SyntaxError,
  ],
  ["missing receipt", (root) => rmSync(join(root, CURRENT_HISTORY_SNAPSHOT)), /ENOENT/u],
]) {
  test(`current snapshot core: clears stale success before ${name} preflight failure`, (t) => {
    const root = fixture(t);
    const { success, failure } = staleEvidence(root);
    change(root);
    assert.throws(
      () =>
        rehearseUpgrade({
          root,
          currentHistory: true,
          execute: () => assert.fail("failed preflight must not execute"),
        }),
      expected,
    );
    assert.equal(existsSync(success), false);
    assert.match(readFileSync(failure, "utf8"), /^upgrade_preflight_failed:/u);
    assert.doesNotMatch(readFileSync(failure, "utf8"), /previous failure|sentinel|ENOENT/u);
    assert.ok(!readFileSync(failure, "utf8").includes(root));
  });
}

for (const invalid of [false, true]) {
  test(`current snapshot core: ${invalid ? "failed" : "valid"} dry-run keeps artifacts`, (t) => {
    const root = fixture(t);
    const paths = staleEvidence(root);
    const before = Object.values(paths).map((path) => readFileSync(path, "utf8"));
    if (invalid) writeFileSync(join(root, CURRENT_HISTORY_SNAPSHOT), "invalid");
    const run = () =>
      rehearseUpgrade({
        root,
        currentHistory: true,
        dryRun: true,
        execute: () => assert.fail("dry-run must not execute"),
      });
    if (invalid) assert.throws(run, SyntaxError);
    else assert.equal(run().executed, false);
    assert.deepEqual(
      Object.values(paths).map((path) => readFileSync(path, "utf8")),
      before,
    );
  });
}

test("current snapshot core: SQLSTATE 42723 stays failed without retry or repair", (t) => {
  const root = fixture(t);
  const { success, failure } = staleEvidence(root);
  const calls = [];
  let project;
  assert.throws(
    () =>
      rehearseUpgrade({
        root,
        currentHistory: true,
        execute(command, args, options) {
          project = options.cwd;
          calls.push({ command, args });
          assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
          if (args[0] === "migration")
            return {
              status: 1,
              stdout: "Connecting to local database...",
              stderr:
                'ERROR: function accept_project_invite(uuid) already exists in schema "kova_private" (SQLSTATE 42723)',
            };
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /upgrade_local_command_failed:supabase:migration:1/u,
  );
  assert.equal(calls.filter((call) => call.args[0] === "migration").length, 1);
  assert.ok(calls.every((call) => !call.args.includes("repair")));
  assert.equal(calls.at(-1).args[0], "stop");
  assert.equal(existsSync(success), false);
  assert.match(readFileSync(failure, "utf8"), /SQLSTATE 42723/u);
  assert.equal(existsSync(project), false);
});

test("current snapshot core: equivalence never removes unrelated pending SQL", (t) => {
  const root = fixture(t);
  const nextName = "20260907120000_synthetic_forward.sql";
  writeFileSync(join(root, "supabase/migrations", nextName), "select 2;\n");
  const plan = rehearseUpgrade({ root, dryRun: true, currentHistory: true });
  assert.deepEqual(plan.pendingVersions, ["20260903145843", "20260907120000"]);
  assert.deepEqual(plan.replayPendingVersions, ["20260907120000"]);
  const sql = [];
  const result = rehearseUpgrade({
    root,
    currentHistory: true,
    execute(command, args, options) {
      const dir = join(options.cwd, "supabase/migrations");
      if (args[0] === "migration") {
        assert.ok(!existsSync(join(dir, sourceName)));
        assert.ok(existsSync(join(dir, remoteName)));
        assert.equal(readFileSync(join(dir, nextName), "utf8"), "select 2;\n");
      }
      if (command === "docker") sql.push(options.input);
      return {
        status: 0,
        stdout: command === "git" && args.includes("rev-parse") ? "a".repeat(40) : "",
        stderr: "",
      };
    },
  });
  assert.deepEqual(
    result.forwardMigrations.map((row) => row.version),
    ["20260907120000"],
  );
  assert.match(sql.at(-1), /20260907120000/u);
  assert.match(sql.at(-1), /20260906024459/u);
  assert.doesNotMatch(sql.at(-1), /20260903145843/u);
  assert.equal(result.currentHistory.requiresCanonicalHistoryReconciliation, true);
});
