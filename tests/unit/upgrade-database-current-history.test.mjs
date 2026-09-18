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

test("current snapshot core: adds the remote alias and preserves canonical forward replay", () => {
  const { plan, snapshot } = syntheticPlan();
  const result = extend(plan, snapshot);
  assert.equal(plan.baseline.length, 97);
  assert.equal(result.baseline.length, 98);
  assert.equal(result.baseline.at(-1).replayName, remoteName);
  assert.equal(result.baseline.at(-1).content, plan.forward[0].content);
  assert.equal(result.forward, plan.forward);
  assert.equal(result.pending, plan.pending);
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
        assert.equal(readdirSync(dir).length, 99);
        assert.ok(existsSync(join(dir, sourceName)));
      }
      if (command === "docker") sql.push(options.input);
      return { status: 0, stdout: command === "git" ? "a".repeat(40) : "", stderr: "" };
    },
  });
  assert.equal(result.baselineVersions, 98);
  assert.match(sql[0], /20260906024459/u);
  assert.doesNotMatch(sql[0], /20260903145843/u);
  assert.match(sql.at(-1), /20260906024459/u);
  assert.match(sql.at(-1), /20260903145843/u);
  assert.ok(!existsSync(join(root, "supabase/migrations", remoteName)));
  assert.ok(!existsSync(project));
  assert.equal(result.currentHistory.productionRowsRestored, false);
});

test("current snapshot core: CLI defaults to 98 with explicit historical opt-out", (t) => {
  const root = fixture(t);
  for (const name of ["upgrade-database.mjs", "upgrade-database-current-history.mjs"])
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
});
