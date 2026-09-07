import assert from "node:assert/strict";
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commit = "1234567890123456789012345678901234567890";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "kova-upgrade-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["supabase/migrations", dirname(MANIFEST), "scripts/release"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  cpSync(join(ROOT, "supabase/migrations"), join(root, "supabase/migrations"), { recursive: true });
  cpSync(join(ROOT, dirname(MANIFEST)), join(root, dirname(MANIFEST)), { recursive: true });
  cpSync(
    join(ROOT, "scripts/release/upgrade-database-assertions.sql"),
    join(root, "scripts/release/upgrade-database-assertions.sql"),
  );
  cpSync(
    join(ROOT, "scripts/release/upgrade-database-seed.sql"),
    join(root, "scripts/release/upgrade-database-seed.sql"),
  );
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mocked pinned executable");
  return root;
}

function fakeExecutor(hook = () => {}) {
  const calls = [];
  return {
    calls,
    execute(command, args, options) {
      const call = { command, args, ...options };
      calls.push(call);
      return hook(call) ?? { status: 0, stdout: command === "git" ? commit : "", stderr: "" };
    },
  };
}

test("dry rehearsal validates the 97-version structural baseline without running a command", () => {
  const result = rehearseUpgrade({ dryRun: true, execute: () => assert.fail("must not execute") });
  assert.equal(result.baselineVersions, 97);
  assert.equal(result.executed, false);
  assert.ok(result.pendingVersions.includes("20260904230332"));
  assert.ok(!result.pendingVersions.includes("20260824085444"));
  const plan = planUpgrade();
  assert.equal(plan.baseline.filter((row) => row.origin === "matched_source").length, 74);
  assert.equal(
    plan.baseline.filter((row) => row.origin === "reviewed_structural_fixture").length,
    23,
  );
});

test("an edited baseline or duplicate source version stops before creating a database", (t) => {
  const root = fixture(t);
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  const path = join(root, manifest.migrations[0].path);
  const original = readFileSync(path);
  writeFileSync(path, "select 'unreviewed structural change';");
  assert.throws(
    () => rehearseUpgrade({ root, execute: () => assert.fail("must not execute") }),
    /upgrade_baseline_changed/,
  );
  writeFileSync(path, original);
  writeFileSync(join(root, "supabase/migrations/20260904230332_duplicate.sql"), "select 1;");
  assert.throws(() => planUpgrade(root), /upgrade_duplicate_source_version/);
});

test("out-of-order history and path traversal are rejected before reading fixture files", (t) => {
  const root = fixture(t);
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  [manifest.migrations[0], manifest.migrations[1]] = [
    manifest.migrations[1],
    manifest.migrations[0],
  ];
  writeFileSync(join(root, MANIFEST), JSON.stringify(manifest));
  assert.throws(() => planUpgrade(root), /upgrade_baseline_changed/);
  manifest.migrations[0].path = "../../file-outside-rehearsal.sql";
  writeFileSync(join(root, MANIFEST), JSON.stringify(manifest));
  assert.throws(() => planUpgrade(root), /upgrade_baseline_changed/);
});

test("rehearsal installs only the reviewed baseline, upgrades pending files, asserts catalogs, and cleans up", (t) => {
  for (const name of [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_REF",
    "DATABASE_URL",
    "PGHOST",
    "DOCKER_CONTEXT",
  ]) {
    const original = process.env[name];
    process.env[name] = "synthetic-remote-value";
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
  }
  const root = fixture(t);
  const plan = planUpgrade(root);
  let project;
  const runner = fakeExecutor((call) => {
    project = call.cwd;
    assert.ok(project.startsWith(join(tmpdir(), "kova-upgrade-")));
    assert.notEqual(project, root);
    assert.equal(call.env.DOCKER_HOST, "unix:///var/run/docker.sock");
    assert.equal(call.env.DOCKER_CONTEXT, undefined);
    assert.equal(call.env.SUPABASE_ACCESS_TOKEN, undefined);
    assert.equal(call.env.SUPABASE_DB_PASSWORD, undefined);
    assert.equal(call.env.SUPABASE_PROJECT_REF, undefined);
    assert.equal(call.env.DATABASE_URL, undefined);
    assert.equal(call.env.PGHOST, undefined);
    assert.ok(!call.args.includes("--linked"));
    assert.ok(!call.args.includes("--db-url"));
    assert.ok(!existsSync(join(project, "supabase/.temp/project-ref")));
    if (call.args[0] === "start" || call.args[0] === "db") {
      assert.equal(readdirSync(join(project, "supabase/migrations")).length, 97);
    }
    if (call.args[0] === "migration") {
      assert.equal(
        readdirSync(join(project, "supabase/migrations")).length,
        97 + plan.forward.length,
      );
      assert.deepEqual(call.args.slice(0, 4), ["migration", "up", "--local", "--include-all"]);
    }
    if (call.command === "docker") {
      assert.deepEqual(call.args.slice(0, 4), [
        "--host",
        "unix:///var/run/docker.sock",
        "exec",
        "-i",
      ]);
      assert.ok(call.args.includes("ON_ERROR_STOP=1"));
    }
  });
  const result = rehearseUpgrade({ root, execute: runner.execute });
  assert.equal(result.sourceCommit, commit);
  assert.equal(result.passed, true);
  assert.equal(result.forwardMigrations.length, plan.forward.length);
  const sqlCalls = runner.calls.filter((call) => call.command === "docker");
  assert.equal(sqlCalls.length, 4);
  assert.match(sqlCalls[0].input, /upgrade_baseline_history_mismatch/);
  assert.match(sqlCalls[0].input, /20260824085444/);
  assert.match(sqlCalls[1].input, /Synthetic fixtures/);
  assert.match(sqlCalls[2].input, /upgrade_family_owner_scope_not_enforced/);
  assert.match(sqlCalls[3].input, /upgrade_final_history_mismatch/);
  assert.equal(runner.calls.at(-1).args[0], "stop");
  assert.ok(!existsSync(project));
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, "artifacts/release/upgrade-database.json"), "utf8")),
    result,
  );
});

test("a failed startup still cleans its generated project and removes stale success evidence", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "artifacts/release"), { recursive: true });
  writeFileSync(join(root, "artifacts/release/upgrade-database.json"), '{"passed":true}');
  const runner = fakeExecutor((call) =>
    call.args[0] === "start" ? { status: 1, stderr: "local startup failed" } : undefined,
  );
  assert.throws(
    () => rehearseUpgrade({ root, execute: runner.execute }),
    /upgrade_local_command_failed/,
  );
  assert.deepEqual(
    runner.calls.map((call) => call.args[0]),
    ["start", "stop"],
  );
  assert.ok(!existsSync(runner.calls[0].cwd));
  assert.ok(!existsSync(join(root, "artifacts/release/upgrade-database.json")));
  assert.match(
    readFileSync(join(root, "artifacts/release/upgrade-failure.log"), "utf8"),
    /local startup failed/,
  );
});

test("baseline assertion failure prevents every pending migration", (t) => {
  const root = fixture(t);
  const runner = fakeExecutor((call) =>
    call.command === "docker" ? { status: 3, stderr: "baseline identity mismatch" } : undefined,
  );
  assert.throws(
    () => rehearseUpgrade({ root, execute: runner.execute }),
    /upgrade_local_command_failed:docker/,
  );
  assert.ok(!runner.calls.some((call) => call.args[0] === "migration"));
  assert.equal(runner.calls.at(-1).args[0], "stop");
  assert.ok(!existsSync(join(root, "artifacts/release/upgrade-database.json")));
});

test("cleanup failure cannot leave a successful rehearsal artifact", (t) => {
  const root = fixture(t);
  const runner = fakeExecutor((call) => (call.args[0] === "stop" ? { status: 1 } : undefined));
  assert.throws(
    () => rehearseUpgrade({ root, execute: runner.execute }),
    /upgrade_local_cleanup_failed/,
  );
  assert.ok(!existsSync(join(root, "artifacts/release/upgrade-database.json")));
  assert.match(
    readFileSync(join(root, "artifacts/release/upgrade-failure.log"), "utf8"),
    /Local cleanup failed for kova_upgrade_/,
  );
});

test("a thrown process error still attempts cleanup and preserves the original failure", (t) => {
  const root = fixture(t);
  const runner = fakeExecutor((call) => {
    throw new Error(`synthetic ${call.args[0]} spawn failure`);
  });
  assert.throws(
    () => rehearseUpgrade({ root, execute: runner.execute }),
    /upgrade_local_command_failed:supabase:start:spawn/,
  );
  assert.deepEqual(
    runner.calls.map((call) => call.args[0]),
    ["start", "stop"],
  );
  assert.ok(!existsSync(runner.calls[0].cwd));
});
