import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { rehearseUpgrade, MANIFEST } from "../../scripts/release/upgrade-database.mjs";
import {
  captureCleanUpgradeSource,
  assertUpgradeSourceUnchanged,
} from "../../scripts/release/upgrade-source-provenance.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEED = "scripts/release/upgrade-database-seed.sql";
const FILES = [
  "upgrade-database.json",
  "upgrade-temp-export-proof.json",
  "upgrade-scheduled-execution-catalog.json",
];
function git(root, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  return execFileSync("git", ["-C", root, ...args], {
    env,
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
}
function commit(root) {
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Local Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
}
function fixture(t, complete = false) {
  const root = mkdtempSync(join(tmpdir(), "kova-source-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".gitignore"), "artifacts/\nnode_modules/\nignored/\n");
  writeFileSync(join(root, "tracked.txt"), "original source\n");
  if (complete) {
    for (const path of ["supabase/migrations", dirname(MANIFEST), "scripts/release"])
      cpSync(join(ROOT, path), join(root, path), { recursive: true });
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(root, "node_modules/.bin/supabase"), "mock executable");
  }
  git(root, "init", "-q");
  git(root, "config", "core.filemode", "true");
  commit(root);
  return root;
}
function edit(root, path = "tracked.txt") {
  writeFileSync(join(root, path), readFileSync(join(root, path), "utf8") + "\n-- source changed\n");
}
function stale(root) {
  const directory = join(root, "artifacts/release");
  mkdirSync(directory, { recursive: true });
  for (const name of FILES) writeFileSync(join(directory, name), '{"passed":true}\n');
  return directory;
}
function noSuccess(directory) {
  for (const name of FILES) assert.equal(existsSync(join(directory, name)), false, name);
}
function databaseMock(root, hook = () => {}) {
  const calls = [];
  return {
    calls,
    execute(command, args, options) {
      const call = { command, args, ...options };
      calls.push(call);
      if (command === "git") return { status: 0, stdout: git(root, ...args.slice(2)), stderr: "" };
      assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(
        !args.includes("--linked") && !args.includes("--db-url") && !args.includes("repair"),
      );
      assert.notEqual(options.cwd, root);
      hook(call);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

test("source provenance: exact clean identity and reader, without index mutation", (t) => {
  const root = fixture(t);
  const index = readFileSync(join(root, ".git/index"));
  const source = captureCleanUpgradeSource(root);
  assert.equal(source.commit, git(root, "rev-parse", "HEAD"));
  assert.equal(source.tree, git(root, "rev-parse", "HEAD^{tree}"));
  assert.equal(source.trackedFileCount, 2);
  assert.equal(source.readFile(join(root, "tracked.txt")).toString(), "original source\n");
  assert.deepEqual(readFileSync(join(root, ".git/index")), index);
  assert.doesNotThrow(() => assertUpgradeSourceUnchanged(source, captureCleanUpgradeSource(root)));
});
for (const staged of [false, true])
  test(`source provenance: rejects ${staged ? "staged" : "unstaged"} bytes`, (t) => {
    const root = fixture(t);
    edit(root);
    if (staged) git(root, "add", "tracked.txt");
    assert.throws(() => captureCleanUpgradeSource(root), /worktree_dirty/u);
  });
test("source provenance: staged edit with restored working bytes is still dirty", (t) => {
  const root = fixture(t),
    original = readFileSync(join(root, "tracked.txt"));
  edit(root);
  git(root, "add", "tracked.txt");
  writeFileSync(join(root, "tracked.txt"), original);
  assert.throws(() => captureCleanUpgradeSource(root), /worktree_dirty/u);
});
test("source provenance: rejects untracked files and tracked deletions", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "untracked.sql"), "select 1;\n");
  assert.throws(() => captureCleanUpgradeSource(root), /worktree_dirty/u);
  rmSync(join(root, "untracked.sql"));
  rmSync(join(root, "tracked.txt"));
  assert.throws(() => captureCleanUpgradeSource(root), /worktree_dirty/u);
});
for (const flag of ["--assume-unchanged", "--skip-worktree"])
  test(`source provenance: catches status-hidden ${flag} edits`, (t) => {
    const root = fixture(t);
    git(root, "update-index", flag, "tracked.txt");
    edit(root);
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.throws(() => captureCleanUpgradeSource(root), /tracked_bytes_changed/u);
  });
test("source provenance: ignored input is not part of the committed tree", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "ignored"));
  writeFileSync(join(root, "ignored/extra.sql"), "select 1;\n");
  const source = captureCleanUpgradeSource(root);
  assert.throws(() => source.readFile(join(root, "ignored/extra.sql")), /input_untracked/u);
  assert.throws(() => source.readFile(join(root, "../outside.sql")), /input_untracked/u);
});
test("source provenance: verifies buffers at consumption, not just two snapshots", (t) => {
  const root = fixture(t),
    source = captureCleanUpgradeSource(root);
  const original = readFileSync(join(root, "tracked.txt"));
  edit(root);
  assert.throws(() => source.readFile(join(root, "tracked.txt")), /tracked_bytes_changed/u);
  writeFileSync(join(root, "tracked.txt"), original);
  // Before and after are both clean; a read in between nevertheless failed.
  assert.doesNotThrow(() => assertUpgradeSourceUnchanged(source, captureCleanUpgradeSource(root)));
  assert.deepEqual(source.readFile(join(root, "tracked.txt")), original);
});
test("source provenance: executable modes are checked despite core.filemode=false", (t) => {
  const root = fixture(t);
  git(root, "config", "core.filemode", "false");
  chmodSync(join(root, "tracked.txt"), 0o755);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.throws(() => captureCleanUpgradeSource(root), /tracked_bytes_changed/u);
});
test("source provenance: rejects symbolic links rather than reading external targets", (t) => {
  const root = fixture(t);
  symlinkSync("tracked.txt", join(root, "alias.txt"));
  commit(root);
  assert.throws(() => captureCleanUpgradeSource(root), /unsupported_entry/u);
});
test("source provenance: repository root and Git availability are mandatory", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "ignored"));
  assert.throws(() => captureCleanUpgradeSource(join(root, "ignored")), /root_mismatch/u);
  assert.throws(() => captureCleanUpgradeSource(join(root, "missing")), /root_invalid/u);
  rmSync(join(root, ".git"), { recursive: true });
  assert.throws(() => captureCleanUpgradeSource(root), /git_failed/u);
});
test("source provenance: inherited Git redirection cannot hide dirty source", (t) => {
  const root = fixture(t),
    other = fixture(t);
  const before = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = join(other, ".git");
  process.env.GIT_WORK_TREE = other;
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  assert.equal(captureCleanUpgradeSource(root).commit, git(root, "rev-parse", "HEAD"));
  edit(root);
  assert.throws(() => captureCleanUpgradeSource(root), /worktree_dirty/u);
});
test("source provenance: changed identity or malformed snapshot fails", (t) => {
  const source = captureCleanUpgradeSource(fixture(t));
  for (const [key, value] of [
    ["commit", "f".repeat(40)],
    ["tree", "e".repeat(40)],
    ["trackedFileCount", 3],
  ])
    assert.throws(
      () => assertUpgradeSourceUnchanged(source, { ...source, [key]: value }),
      /changed_during_rehearsal/u,
    );
  for (const invalid of [
    null,
    {},
    { ...source, commit: "main" },
    { ...source, trackedFileCount: "2" },
    { ...source, readFile: null },
  ])
    assert.throws(() => assertUpgradeSourceUnchanged(source, invalid), /receipt_invalid/u);
});
for (const currentHistory of [false, true])
  for (const staged of [false, true])
    test(`source provenance: ${currentHistory ? "current" : "historical"} full run rejects ${staged ? "staged" : "unstaged"} input before database calls`, (t) => {
      const root = fixture(t, true),
        directory = stale(root);
      edit(root, SEED);
      if (staged) git(root, "add", SEED);
      assert.throws(
        () =>
          rehearseUpgrade({ root, currentHistory, execute: () => assert.fail("must not execute") }),
        /worktree_dirty/u,
      );
      noSuccess(directory);
      assert.equal(
        readFileSync(join(directory, "upgrade-failure.log"), "utf8"),
        "upgrade_preflight_failed:upgrade_source_worktree_dirty\n",
      );
    });
test("source provenance: clean real Git plus mocked database publishes authentic labels", (t) => {
  const root = fixture(t, true),
    runner = databaseMock(root);
  const result = rehearseUpgrade({ root, execute: runner.execute });
  assert.equal(result.passed, true);
  assert.equal(result.sourceCommit, git(root, "rev-parse", "HEAD"));
  assert.equal(runner.calls.at(-1).args[0], "stop");
  assert.equal(existsSync(runner.calls[0].cwd), false);
});
for (const scenario of ["late-commit", "cleanup-edit", "cleanup-hidden-edit", "cleanup-new-commit"])
  test(`source provenance: ${scenario} cannot publish successful evidence`, (t) => {
    const root = fixture(t, true),
      directory = stale(root),
      seed = readFileSync(join(root, SEED), "utf8");
    let changed = false;
    const runner = databaseMock(root, (call) => {
      if (
        changed ||
        (scenario === "late-commit"
          ? call.command !== "docker" || call.input !== seed
          : call.args[0] !== "stop")
      )
        return;
      changed = true;
      if (scenario === "cleanup-hidden-edit") git(root, "update-index", "--skip-worktree", SEED);
      edit(root, SEED);
      if (scenario.endsWith("commit")) commit(root);
    });
    assert.throws(() => rehearseUpgrade({ root, execute: runner.execute }), /upgrade_source_/u);
    assert.equal(changed, true);
    assert.equal(runner.calls.at(-1).args[0], "stop");
    assert.equal(existsSync(runner.calls[0].cwd), false);
    noSuccess(directory);
  });
test("source provenance: ignored pending migration cannot execute", (t) => {
  const root = fixture(t, true),
    directory = stale(root),
    path = "supabase/migrations/20260919120000_ignored.sql";
  writeFileSync(
    join(root, ".gitignore"),
    readFileSync(join(root, ".gitignore"), "utf8") + path + "\n",
  );
  commit(root);
  writeFileSync(join(root, path), "select 1;\n");
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.throws(
    () => rehearseUpgrade({ root, execute: () => assert.fail("must not execute") }),
    /input_untracked/u,
  );
  noSuccess(directory);
});
test("source provenance: transient edit after inspection is rejected by the bound reader", (t) => {
  const root = fixture(t, true),
    directory = stale(root);
  let readAttempt = false;
  assert.throws(
    () =>
      rehearseUpgrade({
        root,
        inspectSource(directory) {
          const snapshot = captureCleanUpgradeSource(directory);
          const bound = snapshot.readFile;
          return {
            ...snapshot,
            readFile(path) {
              if (!path.endsWith("upgrade-database-seed.sql")) return bound(path);
              readAttempt = true;
              const original = readFileSync(path);
              edit(root, SEED);
              try {
                return bound(path);
              } finally {
                writeFileSync(path, original);
              }
            },
          };
        },
        execute: () => assert.fail("must not execute"),
      }),
    /tracked_bytes_changed/u,
  );
  assert.equal(readAttempt, true);
  assert.equal(git(root, "status", "--porcelain"), "");
  noSuccess(directory);
});
test("source provenance: dirty dry-run retains existing files and executes no Git or database commands", (t) => {
  const root = fixture(t, true),
    directory = stale(root);
  edit(root, SEED);
  const result = rehearseUpgrade({
    root,
    dryRun: true,
    inspectSource: () => assert.fail("dry run must not inspect"),
    execute: () => assert.fail("must not execute"),
  });
  assert.equal(result.executed, false);
  for (const name of FILES)
    assert.equal(readFileSync(join(directory, name), "utf8"), '{"passed":true}\n');
});

for (const currentHistory of [false, true])
  test(`source inventory: ${currentHistory ? "current" : "historical"} omitted-and-restored migration cannot pass`, (t) => {
    const root = fixture(t, true),
      directory = stale(root);
    const migrations = git(
      root,
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
      "supabase/migrations",
    ).split("\n");
    const manifest = JSON.parse(readFileSync(join(root, MANIFEST)));
    const baseline = new Set(manifest.migrations.map((entry) => entry.version));
    const candidates = migrations.filter(
      (path) => !baseline.has(path.split("/").at(-1).slice(0, 14)),
    );
    const path = candidates.find((name) => !name.includes("20260903145843"));
    assert.ok(path);
    const omittedVersion = path.split("/").at(-1).slice(0, 14);
    const original = readFileSync(join(root, path));
    let removed = false;
    const runner = databaseMock(root);
    try {
      assert.throws(() => {
        const result = rehearseUpgrade({
          root,
          currentHistory,
          inspectSource(directory) {
            const source = captureCleanUpgradeSource(directory);
            if (removed) return source;
            removed = true;
            rmSync(join(root, path));
            return {
              ...source,
              readFile(filename) {
                // Restore only after directory discovery has selected a forward
                // file. Old code can then finish with a clean HEAD but skip SQL.
                if (candidates.some((name) => join(root, name) === filename))
                  writeFileSync(join(root, path), original);
                return source.readFile(filename);
              },
            };
          },
          execute: runner.execute,
        });
        t.diagnostic(
          JSON.stringify({
            publishedSuccess: result.passed,
            omittedVersion,
            omittedFromPending: !result.pendingVersions.includes(omittedVersion),
            cleanAtPublication: git(root, "status", "--porcelain") === "",
          }),
        );
      }, /upgrade_source_directory_inventory_changed/u);
      assert.equal(runner.calls.length, 0);
      noSuccess(directory);
    } finally {
      writeFileSync(join(root, path), original);
    }
  });

test("source inventory: directory names come from the captured tree without shared mutable state", (t) => {
  const root = fixture(t, true),
    source = captureCleanUpgradeSource(root),
    path = join(root, "supabase/migrations");
  const expected = git(root, "ls-tree", "--name-only", "HEAD:supabase/migrations")
    .split("\n")
    .sort();
  const originalIndex = readFileSync(join(root, ".git/index"));
  assert.deepEqual(source.readDirectory(path), expected);
  const returned = source.readDirectory(path);
  returned.pop();
  returned.push("fabricated.sql");
  assert.deepEqual(source.readDirectory(path), expected);
  assert.deepEqual(readFileSync(join(root, ".git/index")), originalIndex);
});

test("source inventory: ignored added migration after source capture is rejected", (t) => {
  const root = fixture(t, true),
    path = "supabase/migrations/20260919120100_ignored_after_capture.sql";
  writeFileSync(
    join(root, ".gitignore"),
    readFileSync(join(root, ".gitignore"), "utf8") + path + "\n",
  );
  commit(root);
  const source = captureCleanUpgradeSource(root);
  writeFileSync(join(root, path), "select 1;\n");
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.throws(() => source.readDirectory(join(root, "supabase/migrations")), /input_untracked/u);
});

test("source inventory: renamed committed migration cannot replace its captured filename", (t) => {
  const root = fixture(t, true),
    directory = join(root, "supabase/migrations"),
    source = captureCleanUpgradeSource(root),
    name = source.readDirectory(directory).find((name) => name.endsWith(".sql"));
  const bytes = readFileSync(join(directory, name));
  rmSync(join(directory, name));
  writeFileSync(join(directory, "20260919120200_renamed.sql"), bytes);
  assert.throws(() => source.readDirectory(directory), /input_untracked/u);
});

test("source inventory: absent or untracked directory cannot be treated as empty", (t) => {
  const root = fixture(t, true),
    source = captureCleanUpgradeSource(root);
  assert.throws(() => source.readDirectory(join(root, "ignored")), /input_untracked/u);
  assert.throws(() => source.readDirectory(join(root, "../outside")), /input_untracked/u);
  rmSync(join(root, "supabase/migrations"), { recursive: true });
  assert.throws(
    () => source.readDirectory(join(root, "supabase/migrations")),
    /directory_unreadable/u,
  );
});

test("source inventory: symlink replacement cannot supply a matching directory listing", (t) => {
  const root = fixture(t, true),
    source = captureCleanUpgradeSource(root),
    path = join(root, "supabase/migrations"),
    replacement = join(root, "ignored/migrations");
  mkdirSync(join(root, "ignored"));
  cpSync(path, replacement, { recursive: true });
  rmSync(path, { recursive: true });
  symlinkSync(replacement, path);
  assert.throws(() => source.readDirectory(path), /directory_unreadable/u);
});

test("source inventory: source receipts must provide a bound directory reader", (t) => {
  const source = captureCleanUpgradeSource(fixture(t));
  for (const readDirectory of [null, undefined, "readdirSync", []])
    assert.throws(
      () => assertUpgradeSourceUnchanged(source, { ...source, readDirectory }),
      /receipt_invalid/u,
    );
});

test("source inventory: current full rehearsal preserves the entire committed pending range", (t) => {
  const root = fixture(t, true),
    runner = databaseMock(root);
  const dry = rehearseUpgrade({ root, dryRun: true, currentHistory: true });
  const actual = rehearseUpgrade({ root, currentHistory: true, execute: runner.execute });
  assert.equal(actual.passed, true);
  assert.equal(actual.baselineVersions, 98);
  assert.equal(actual.pendingVersions.length, 87);
  assert.equal(actual.forwardMigrations.length, 86);
  assert.deepEqual(actual.pendingVersions, dry.pendingVersions);
  assert.deepEqual(actual.replayPendingVersions, dry.replayPendingVersions);
  assert.equal(actual.sourceCommit, git(root, "rev-parse", "HEAD"));
});
