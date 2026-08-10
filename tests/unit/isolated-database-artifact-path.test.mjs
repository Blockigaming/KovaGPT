import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";

const sourcePath = "scripts/release/isolated-database.mjs";
const scriptPath = resolve(sourcePath);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withMockNpx({ args = [], failCommand = "", failCode = 1 } = {}, assertion) {
  const root = await mkdtemp(join(tmpdir(), "kovagpt-isolated-database-"));
  const binDirectory = join(root, "bin");
  const tracePath = join(root, "npx-trace.log");
  const mockNpxPath = join(binDirectory, "npx");

  await mkdir(binDirectory, { recursive: true });
  await writeFile(
    mockNpxPath,
    `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TRACE_FILE"
if [ -n "\${FAIL_COMMAND:-}" ]; then
  case "$*" in
    "$FAIL_COMMAND"*) exit "\${FAIL_CODE:-1}" ;;
  esac
fi
exit 0
`,
    "utf8",
  );
  await chmod(mockNpxPath, 0o755);

  try {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
        TRACE_FILE: tracePath,
        FAIL_COMMAND: failCommand,
        FAIL_CODE: String(failCode),
      },
    });
    const trace = await readFile(tracePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const commands = trace
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    await assertion({ root, result, commands });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("isolated database script creates the release artifact directory before database work", async () => {
  const source = await readFile(sourcePath, "utf8");
  const createDirectory = source.indexOf("mkdirSync(artifactDirectory, { recursive: true })");
  const start = source.indexOf('run(["start"');
  const dump = source.indexOf('run(["db", "dump"');

  assert.ok(createDirectory >= 0 && start > createDirectory && dump > start);
  assert.match(
    source,
    /const isolatedSchemaPath = `\$\{artifactDirectory\}\/isolated-schema\.sql`/u,
  );
  assert.match(source, /-f", isolatedSchemaPath/u);
  assert.doesNotMatch(source, /process\.exit\(/u);
  assert.match(source, /process\.exitCode = failure\.exitCode/u);
});

test("successful isolated run executes the local-only sequence and creates its output directory", async () => {
  await withMockNpx({}, async ({ root, result, commands }) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(commands, [
      "supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor",
      "supabase db reset --local",
      "supabase migration list --local",
      "supabase db dump --local --schema public -f artifacts/release/isolated-schema.sql",
      "supabase stop --no-backup",
    ]);
    const artifactStat = await stat(join(root, "artifacts", "release"));
    assert.equal(artifactStat.isDirectory(), true);
  });
});

test("a reset failure preserves its exit code and still stops a started local stack", async () => {
  await withMockNpx(
    { failCommand: "supabase db reset", failCode: 23 },
    async ({ result, commands }) => {
      assert.equal(result.status, 23);
      assert.deepEqual(commands, [
        "supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor",
        "supabase db reset --local",
        "supabase stop --no-backup",
      ]);
    },
  );
});

test("a dump failure remains authoritative and cleanup runs afterward", async () => {
  await withMockNpx(
    { failCommand: "supabase db dump", failCode: 31 },
    async ({ result, commands }) => {
      assert.equal(result.status, 31);
      assert.deepEqual(commands, [
        "supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor",
        "supabase db reset --local",
        "supabase migration list --local",
        "supabase db dump --local --schema public -f artifacts/release/isolated-schema.sql",
        "supabase stop --no-backup",
      ]);
    },
  );
});

test("a failed start does not pretend that a stack exists to stop", async () => {
  await withMockNpx(
    { failCommand: "supabase start", failCode: 17 },
    async ({ result, commands }) => {
      assert.equal(result.status, 17);
      assert.deepEqual(commands, [
        "supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor",
      ]);
    },
  );
});

test("cleanup failure makes an otherwise successful run fail", async () => {
  await withMockNpx(
    { failCommand: "supabase stop", failCode: 42 },
    async ({ result, commands }) => {
      assert.equal(result.status, 1);
      assert.equal(commands.at(-1), "supabase stop --no-backup");
    },
  );
});

test("dry-run is local-only and performs no filesystem or process mutation", async () => {
  await withMockNpx({ args: ["--dry-run"] }, async ({ root, result, commands }) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(commands, []);
    assert.match(result.stdout, /create artifacts\/release/u);
    assert.match(result.stdout, /No remote database is used/u);
    assert.equal(await pathExists(join(root, "artifacts")), false);
  });
});
