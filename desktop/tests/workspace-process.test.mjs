import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalCommandRunner,
  localProcessEnvironment,
  readGit,
  validateCommand,
} from "../workspace-process.mjs";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kova-command-")));
  const runner = createLocalCommandRunner();
  const command = (script) => {
    const file = join(root, "task.mjs");
    writeFileSync(file, script);
    return `"${process.execPath}" "${file}"`;
  };
  return {
    root,
    runner,
    command,
    cleanup() {
      runner.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
async function finished(runner) {
  const start = Date.now();
  while (runner.isBusy()) {
    if (Date.now() - start > 8_000) throw new Error("Command failed to finish");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return runner.snapshot()[0];
}

test("local terminal executes in selected folder, captures stdout/stderr and nonzero exit", async () => {
  const f = fixture();
  try {
    f.runner.start(
      f.root,
      f.command(
        'import { writeFileSync } from "node:fs"; writeFileSync("result.txt", "local"); console.log(process.cwd()); console.error("diagnostic"); process.exitCode = 7;',
      ),
    );
    const result = await finished(f.runner);
    assert.equal(result.state, "failed");
    assert.equal(result.exitCode, 7, result.output);
    assert.match(result.output, /diagnostic/u);
    assert.ok(result.output.includes(f.root));
    assert.equal(readFileSync(join(f.root, "result.txt"), "utf8"), "local");
    assert.ok(result.finishedAt);
    const copy = f.runner.snapshot();
    copy[0].output = "forged";
    assert.notEqual(f.runner.snapshot()[0].output, "forged");
  } finally {
    f.cleanup();
  }
});

test("terminal denies concurrent runs and cancellation stops a running task", async () => {
  const f = fixture();
  try {
    f.runner.start(f.root, f.command('console.log("started"); setInterval(() => {}, 1000);'));
    assert.throws(() => f.runner.start(f.root, "echo concurrent"), /Stop the running/u);
    assert.throws(() => f.runner.clear(), /Stop the running/u);
    assert.equal(f.runner.cancel().cancelled, true);
    assert.equal((await finished(f.runner)).state, "cancelled");
    assert.equal(f.runner.cancel().cancelled, false);
    f.runner.clear();
    assert.deepEqual(f.runner.snapshot(), []);
  } finally {
    f.cleanup();
  }
});

test("terminal bounds runtime and output instead of letting tasks hang or exhaust memory", async () => {
  const f = fixture();
  const timed = createLocalCommandRunner({ timeoutMs: 100 });
  const bounded = createLocalCommandRunner({ maxOutputBytes: 1000 });
  try {
    timed.start(f.root, f.command("setInterval(() => {}, 1000);"));
    assert.equal((await finished(timed)).state, "timed-out");
    bounded.start(f.root, f.command('process.stdout.write("x".repeat(100000));'));
    const result = await finished(bounded);
    assert.equal(result.state, "output-limit");
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.output) <= 1000);
  } finally {
    timed.dispose();
    bounded.dispose();
    f.cleanup();
  }
});

test("closed runner cannot restart and command environment excludes app credentials", () => {
  const f = fixture();
  try {
    for (const command of ["", "  ", null, {}, "x\0y", "a".repeat(4097)])
      assert.throws(() => validateCommand(command), /command/u);
    assert.deepEqual(
      localProcessEnvironment({
        PATH: "/bin",
        OPENAI_API_KEY: "private",
        GIT_DIR: "outside",
        NODE_OPTIONS: "--require hostile",
        ELECTRON_RUN_AS_NODE: "1",
      }),
      { PATH: "/bin" },
    );
    f.runner.dispose();
    assert.throws(() => f.runner.start(f.root, "echo no"), /closed/u);
  } finally {
    f.cleanup();
  }
});

test("source control reads actual status, unstaged/staged diffs and commits without executing diff drivers", async () => {
  const f = fixture();
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: f.root,
      encoding: "utf8",
      env: { ...localProcessEnvironment(), GIT_CONFIG_NOSYSTEM: "1" },
    });
  try {
    git("init");
    writeFileSync(join(f.root, "hello.txt"), "before\n");
    git("add", "hello.txt");
    git(
      "-c",
      "user.name=Kova Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Initial local commit",
    );
    writeFileSync(join(f.root, "hello.txt"), "after\n");
    git("config", "diff.external", "must-not-run");
    assert.match((await readGit(f.root, "status")).output, / M hello.txt/u);
    assert.match((await readGit(f.root, "diff")).output, /\+after/u);
    git("add", "hello.txt");
    assert.match((await readGit(f.root, "staged")).output, /\+after/u);
    assert.match((await readGit(f.root, "log")).output, /Initial local commit/u);
    assert.throws(() => readGit(f.root, "reset"), /Unsupported Git/u);
    assert.throws(() => readGit(f.root, "__proto__"), /Unsupported Git/u);
  } finally {
    f.cleanup();
  }
});
