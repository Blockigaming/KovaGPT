import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("CI contains all release gates and immutable actions", async () => {
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const gate of [
    "typecheck",
    "lint",
    "build",
    "test:unit",
    "test:integration",
    "test:api",
    "test:a11y",
    "test:visual",
    "test:browser",
    "test:e2e",
    "release:migrations",
    "release:bundle",
    "release:security",
    "npm audit",
    "git diff --check",
  ])
    assert.match(ci, new RegExp(gate.replaceAll(":", "\\:")));
  assert.doesNotMatch(ci, /uses:\s+[^\n]+@v\d/);
});
test("smoke defaults to dry-run and never performs paid actions", async () => {
  const s = await readFile(new URL("../../scripts/release/smoke.mjs", import.meta.url), "utf8");
  assert.match(s, /SAFE DRY RUN/);
  assert.match(s, /KOVA_STAGING_SMOKE\s*===\s*["']1["']/);
  assert.doesNotMatch(s, /\/api\/(?:checkout|chat|agents\/runs|scheduled-tasks)/i);
});

test("authoritative release evidence names the current integrated candidate", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../docs/release-reconciliation/reconciliation-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const report = await readFile(
    new URL("../../docs/release-reconciliation/final-release-report.md", import.meta.url),
    "utf8",
  );
  const candidate = manifest.currentCandidate;

  assert.equal(candidate.validatedHead, "6c0562bad99a97bb8f33a783ed18e30bee4e727d");
  assert.equal(candidate.publicationStatus, "local_only_not_pushed");
  assert.equal(candidate.productionStatus, "not_deployed");
  assert.deepEqual(candidate.gates.unit, { total: 1590, passing: 1590, failing: 0 });
  assert.deepEqual(candidate.gates.release, {
    total: 23,
    passing: 23,
    failing: 0,
    evidenceContractAfterReportUpdate: "24/24 passing",
  });
  assert.deepEqual(candidate.gates.integration, {
    total: 484,
    passing: 483,
    failing: 1,
    sourceContractFailures: 0,
    environmentFailures: 1,
    environmentFailure:
      "Wrangler/workerd could not enumerate sandbox network interfaces: uv_interface_addresses returned Unknown system error 1",
  });
  assert.equal(candidate.liveReadOnlyAudit.hydrationFailureReproduced, true);
  assert.equal(manifest.postValidationUpdates.length, 1);
  assert.equal(manifest.postValidationUpdates[0].sourceHead, "80fa6d5a");
  assert.equal(manifest.postValidationUpdates[0].capability, "verified_work_to_sites_draft_bridge");
  assert.equal(manifest.postValidationUpdates[0].liveEffects, "none");
  assert.match(report, /Integrated candidate update — 2026-09-07/u);
  assert.match(report, /483\/484 pass; zero source-contract failures/u);
  assert.match(report, /The branch is local only: it has not been pushed, deployed/u);
  assert.match(report, /Commit `80fa6d5a` closes the Work-to-Sites source gap/u);
  assert.match(report, /Import never publishes/u);
});
