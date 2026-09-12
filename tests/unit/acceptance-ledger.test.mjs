import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildAcceptanceLedger,
  serializeAcceptanceLedger,
} from "../../scripts/release/acceptance-ledger.mjs";

test("granular acceptance ledger covers every area and evidence stage", () => {
  const ledger = buildAcceptanceLedger();

  assert.equal(ledger.schemaVersion, 2);
  assert.equal(ledger.auditedMainCommit, "b046727e3336b0f8df48a8097ad131e94cbf4ffe");
  assert.deepEqual(ledger.reviewedCandidate, {
    pullRequest: 319,
    head: "20940476881dadabfcedbfeadb4aba328dd8cd52",
  });
  assert.equal(ledger.ownerDeclaredOverallProgress, 76.5);
  assert.equal(ledger.progressKind, "owner_declared_checkpoint");
  assert.equal(ledger.progressRecalculated, false);
  assert.equal(ledger.uiCompletion.value, 1);
  assert.equal(ledger.uiCompletion.kind, "separate_owner_quality_assessment");
  assert.equal(ledger.verification.masterAreas, 27);
  assert.equal(ledger.verification.stagesPerArea, 5);
  assert.equal(ledger.verification.acceptanceRows, 135);
  assert.equal(ledger.verification.uniqueAcceptanceRows, 135);
  assert.equal(ledger.verification.finalGoalRequirements, 21);
  assert.deepEqual(ledger.verification.finalGoalStatusCounts, {
    source_partial: 19,
    specified_unimplemented: 1,
    not_verified: 1,
  });
  assert.deepEqual(ledger.verification.statusCounts, {
    partial: 23,
    verified_for_implemented_scope: 54,
    not_verified: 54,
    accepted: 4,
  });
  assert.equal(ledger.verification.missingEvidencePaths, 0);
  assert.equal(ledger.verification.missingRetainedLegacyTests, 0);
  assert.ok(ledger.verification.currentTestFiles >= ledger.verification.retainedLegacyTests);
});

test("final-goal requirements retain owner scope and honest evidence boundaries", () => {
  const ledger = buildAcceptanceLedger();
  const workSource = ledger.rows.find((row) => row.id === "07.source");
  const workProduction = ledger.rows.find((row) => row.id === "07.production");
  const skillsSource = ledger.rows.find((row) => row.id === "14.source");
  const platformSource = ledger.rows.find((row) => row.id === "24.source");
  const voice = ledger.finalGoal.requirements.find((requirement) => requirement.id === "FG-05");

  assert.equal(ledger.finalGoal.owner, "Zachary");
  assert.equal(ledger.finalGoal.voiceRequired, true);
  assert.equal(workSource?.status, "partial");
  assert.match(workSource?.requirement ?? "", /specialist runs/i);
  assert.equal(workProduction?.status, "not_verified");
  assert.equal(skillsSource?.status, "partial");
  assert.match(skillsSource?.requirement ?? "", /immutable workflow skills/i);
  assert.match(skillsSource?.boundary ?? "", /WebMCP/i);
  assert.equal(platformSource?.status, "partial");
  assert.match(platformSource?.boundary ?? "", /Voice is required but unavailable/i);
  assert.ok(platformSource?.finalGoalRequirementIds.includes("FG-05"));
  assert.equal(voice?.status, "specified_unimplemented");
  assert.deepEqual(voice?.evidence, []);
  assert.match(voice?.acceptanceTest ?? "", /full-duplex/i);
  for (const requirement of ledger.finalGoal.requirements) {
    assert.equal(requirement.owner, "Zachary");
    assert.ok(requirement.dependencies.length > 0);
    assert.ok(requirement.mappedAreaIds.length > 0);
    assert.ok(requirement.acceptanceTest.length > 0);
    assert.ok(requirement.boundary.length > 0);
  }
});

test("hosted evidence names the reviewed PR 319 implementation head and successful runs", () => {
  const ledger = buildAcceptanceLedger();
  assert.equal(ledger.exactHeadEvidence.pullRequest, 319);
  assert.equal(
    ledger.exactHeadEvidence.pullRequestHead,
    "20940476881dadabfcedbfeadb4aba328dd8cd52",
  );
  assert.deepEqual(ledger.exactHeadEvidence.workflows, [
    { id: 34664358655, name: "KovaGPT CI", conclusion: "success" },
    {
      id: 34664358673,
      name: "Azure Container Readiness",
      conclusion: "success",
    },
  ]);
});

test("current scope documents do not retain superseded progress or Voice exclusions", async () => {
  const paths = [
    "../../docs/release/acceptance-ledger.md",
    "../../docs/remaining-chatgpt-gaps.md",
    "../../docs/chatgpt-feature-parity.md",
    "../../docs/product-parity/kova-capability-inventory.md",
    "../../docs/product-parity/intentionally-excluded.md",
    "../../docs/release-reconciliation/voice-removal-verification.md",
    "../../docs/page-parity/page-parity-report.md",
    "../../docs/product-parity/2026-08-11-final-evidence.md",
    "../../docs/day12-unique-feature-audit.md",
    "../../docs/kova-final-completion-matrix.md",
  ];
  const sources = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /23\.2%/u);
    assert.doesNotMatch(source, /Voice(?:[^.\n]{0,80})intentionally excluded/iu);
  }
  assert.match(sources.join("\n"), /owner-declared \*\*76\.5%\*\*/u);
  assert.match(sources.join("\n"), /Voice is required but unavailable/u);
});

test("acceptance ledger serialization is deterministic", async () => {
  assert.equal(await serializeAcceptanceLedger(), await serializeAcceptanceLedger());
});

test("the normal release gate rejects a stale acceptance ledger", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["release:validate"], /npm run release:acceptance-ledger/u);
});
