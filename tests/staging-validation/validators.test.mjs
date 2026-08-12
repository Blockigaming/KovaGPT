import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";

function run(script, args = []) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }));
}

test("environment inventory is checked without reading secret values", () => {
  const output = run("scripts/staging-validation/environment-diff.mjs", [
    "--input",
    "tests/fixtures/staging/environment-names.txt",
  ]);
  assert.equal(output.status, "PASS");
  assert.equal(output.secretValuesInspected, false);
});

test("Azure preflight requires immutable digest and validates traffic", () => {
  const output = run("scripts/staging-validation/azure-preflight.mjs", [
    "--metadata",
    "tests/fixtures/staging/azure.json",
  ]);
  assert.equal(output.status, "PASS");
  assert.equal(output.commandClass, "READ ONLY");
});

test("Azure rollback is dry-run and preserves revisions", () => {
  const output = run("scripts/staging-validation/azure-rollback.mjs", [
    "--metadata",
    "tests/fixtures/staging/revisions.json",
    "--known-good",
    "ca-kovagpt-staging--good",
    "--candidate",
    "ca-kovagpt-staging--candidate",
  ]);
  assert.equal(output.status, "PASS");
  assert.equal(output.executed, false);
  assert.match(output.invariant, /never deleted/u);
});

test("auth rehearsal only establishes preflight, never claims another request is safe", () => {
  const output = run("scripts/staging-validation/auth-migration-rehearsal.mjs", [
    "--metadata",
    "tests/fixtures/staging/auth-migration.json",
  ]);
  assert.equal(output.status, "PASS");
  assert.equal(output.safeToSendAnotherRequest, false);
});

test("callback validator rejects localhost and wildcard hosts", () => {
  const good = run("scripts/staging-validation/domain-callbacks.mjs", [
    "--input",
    "tests/fixtures/staging/callbacks.json",
  ]);
  assert.equal(good.status, "PASS");
  const invalid = spawnSync(
    process.execPath,
    [
      "scripts/staging-validation/domain-callbacks.mjs",
      "--input",
      "tests/fixtures/staging/callbacks-invalid.json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalid.status, 2);
});

test("artifact validator enforces non-root, locked, secret-excluding image", () => {
  const output = run("scripts/staging-validation/artifact.mjs");
  assert.equal(output.status, "PASS");
});

test("configured text models have catalog and billing dimensions", () => {
  const output = run("scripts/staging-validation/model-catalog.mjs");
  assert.equal(output.status, "PASS");
  assert.equal(output.failClosedAtRuntime, true);
  assert.match(output.liveAvailability, /NOT EXECUTED/u);
});

test("orchestrator distinguishes deterministic pass from unexecuted live checks", () => {
  const output = run("scripts/staging-validation/orchestrate.mjs", [
    "--environment",
    "tests/fixtures/staging/environment-names.txt",
    "--callbacks",
    "tests/fixtures/staging/callbacks.json",
    "--azure",
    "tests/fixtures/staging/azure.json",
  ]);
  assert.equal(output.status, "WARNING");
  assert.equal(output.blockers, 0);
  assert.equal(output.credentialGatedNotExecuted, 6);
});

test("auth migration bundle contract has no unsupported minified postgres symbol", () => {
  const check = spawnSync("rg", ["-n", "\\.C\\(|postgres\\.C", "src", "worker", "scripts"], {
    encoding: "utf8",
  });
  assert.equal(check.status, 1);
});

test("live Supabase and provider tools fail closed without credentials", () => {
  const rls = spawnSync(
    process.execPath,
    [
      "scripts/staging-validation/supabase-two-user.mjs",
      "--manifest",
      "docs/production-readiness/supabase-two-user-manifest.example.json",
      "--execute",
    ],
    { encoding: "utf8" },
  );
  assert.equal(rls.status, 2);
  assert.doesNotMatch(rls.stdout, /eyJ[a-zA-Z0-9_-]+\.|sk_(?:live|test)_/u);
  const provider = spawnSync(
    process.execPath,
    [
      "scripts/staging-validation/provider-smoke.mjs",
      "--url",
      "https://staging.example/api/chat",
      "--model",
      "configured-model",
      "--execute",
    ],
    { encoding: "utf8" },
  );
  assert.equal(provider.status, 2);
  assert.doesNotMatch(provider.stdout, /Authorization/u);
});
