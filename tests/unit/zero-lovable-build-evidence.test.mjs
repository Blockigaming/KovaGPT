import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("../../scripts/release/zero-lovable.mjs", import.meta.url));

function runAudit(t, { directories = [], files = {}, requireBuild = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kova-build-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "kova-audit-fixture" }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: {} }),
  );
  for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const args = [scanner, "--strict-lock"];
  if (requireBuild) args.push("--require-build");
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test("built-output audit rejects a missing dist directory without emitting PASS", (t) => {
  const result = runAudit(t);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist: built output is required/u);
  assert.doesNotMatch(result.stdout, /ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS/u);
});

test("built-output audit rejects an empty dist directory without emitting PASS", (t) => {
  const result = runAudit(t, { directories: ["dist"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist: built output contains no files/u);
  assert.doesNotMatch(result.stdout, /ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS/u);
});

test("built-output audit rejects dist containing only empty subdirectories", (t) => {
  const result = runAudit(t, { directories: ["dist/client/assets", "dist/server"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist: built output contains no files/u);
  assert.doesNotMatch(result.stdout, /ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS/u);
});

test("built-output audit accepts and counts a clean nonempty bundle", (t) => {
  const result = runAudit(t, {
    files: { "dist/server/index.mjs": 'console.log("KovaGPT");\n' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requireBuild=true bundleFiles=1 sourceMaps=0 warnings=0/u);
});

test("built-output audit still rejects a nonempty bundle with a retired runtime", (t) => {
  const result = runAudit(t, {
    files: { "dist/server/index.mjs": 'fetch("https://ai-gateway.lovable.dev");\n' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Lovable-named bundle content/u);
  assert.doesNotMatch(result.stdout, /ZERO_LOVABLE_SOURCE_BUILD_AUDIT=PASS/u);
});

test("source-only audit can run before a build exists", (t) => {
  const result = runAudit(t, { requireBuild: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requireBuild=false bundleFiles=0/u);
});

test("source-only audit does not mistake an empty dist directory for a required build", (t) => {
  const result = runAudit(t, { requireBuild: false, directories: ["dist"] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requireBuild=false bundleFiles=0/u);
});
