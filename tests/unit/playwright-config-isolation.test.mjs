import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRootFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the general Playwright matrix excludes dedicated QA specs", async () => {
  const [generalConfig, authVisualConfig, deployedAuditConfig] = await Promise.all([
    readRootFile("playwright.config.ts"),
    readRootFile("playwright.auth-visual.config.ts"),
    readRootFile("playwright.deployed-audit.config.ts"),
  ]);

  assert.match(
    generalConfig,
    /testIgnore:\s*\[\s*"\*\*\/auth-visual-regression\.spec\.ts",\s*"\*\*\/deployed-baseline-audit\.spec\.ts",?\s*\]/u,
  );
  assert.match(authVisualConfig, /testMatch:\s*"auth-visual-regression\.spec\.ts"/u);
  assert.match(deployedAuditConfig, /testMatch:\s*"deployed-baseline-audit\.spec\.ts"/u);
  assert.match(deployedAuditConfig, /timeout:\s*90_000/u);
});

test("visual evidence contains screenshots rendered by the candidate", async () => {
  const [workflow, helper, shellSpec, authSpec] = await Promise.all([
    readRootFile(".github/workflows/ci.yml"),
    readRootFile("tests/e2e/candidate-visual-evidence.ts"),
    readRootFile("tests/e2e/ui-quality.spec.ts"),
    readRootFile("tests/e2e/auth-visual-regression.spec.ts"),
  ]);

  assert.match(
    workflow,
    /KOVA_CANDIDATE_VISUAL_EVIDENCE_DIR: artifacts\/ui-audit\/candidate-visual/u,
  );
  assert.match(workflow, /path: artifacts\/ui-audit\/candidate-visual\/\*\.png/u);
  assert.doesNotMatch(workflow, /candidate-visual-baselines/u);
  assert.match(
    workflow,
    /path: artifacts\/ui-audit\/deployed-baseline[\s\S]{0,120}if-no-files-found: error/u,
  );
  assert.match(workflow, /if: always\(\) && steps\.deployed_baseline\.outcome != 'skipped'/u);
  assert.match(helper, /await page\.screenshot\(/u);
  assert.match(helper, /KOVA_CANDIDATE_VISUAL_EVIDENCE_DIR/u);
  assert.match(shellSpec, /await captureCandidateVisual\(/u);
  assert.match(authSpec, /await captureCandidateVisual\(/u);
});

test("auth visual preview uses tracked candidate edits without copying local secrets", async () => {
  const source = await readRootFile("tests/e2e/auth-visual-preview.mjs");

  assert.match(source, /\["ls-files", "-z", "--cached"\]/u);
  assert.match(source, /await copyFile\(source, destination\)/u);
  assert.match(source, /baseName\.startsWith\("\.env"\)/u);
  assert.match(source, /excludedTreePrefixes/u);
  assert.match(source, /inheritedChildEnvironmentNames/u);
  assert.match(source, /env: childEnvironment/u);
  assert.doesNotMatch(source, /env: process\.env/u);
  assert.doesNotMatch(source, /git", \["archive"/u);
  assert.doesNotMatch(source, /"--others"/u);
});

test("deployed baseline evidence classifies observations truthfully", async () => {
  const source = await readRootFile("tests/e2e/deployed-baseline-audit.spec.ts");

  assert.match(source, /classification: "observational-production-baseline"/u);
  assert.match(source, /navigationError === null && status !== null && status >= 200/u);
  assert.match(source, /reachability,/u);
  assert.doesNotMatch(source, /observed-failed-production-baseline/u);
});

test("dependency audit retries registry errors without weakening the gate", async () => {
  const workflow = await readRootFile(".github/workflows/ci.yml");

  assert.match(workflow, /for attempt in 1 2 3/u);
  assert.match(workflow, /npm audit --audit-level=high --omit=dev/u);
  assert.match(workflow, /timeout --signal=TERM --kill-after=10s 210s npm audit/u);
  assert.match(workflow, /if \[\[ "\$attempt" -eq 3 \]\]; then[\s\S]*?exit 1/u);
  assert.doesNotMatch(workflow, /name: Dependency audit[\s\S]{0,160}continue-on-error:\s*true/u);
});
