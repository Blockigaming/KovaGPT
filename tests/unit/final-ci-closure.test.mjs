import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Worker smoke test disables unavailable AI providers without weakening runtime validation", async () => {
  const source = await readFile("tests/integration/production-worker-artifact.test.mjs", "utf8");
  assert.match(source, /"--var",\s*"AI_GENERATION_ENABLED:false"/u);
  assert.match(source, /"--var",\s*"AZURE_ENVIRONMENT:ci"/u);
  assert.doesNotMatch(source, /AI_GENERATION_ENABLED:\s*"false"/u);
  assert.match(source, /Worker did not become healthy/u);
});

test("Azure readiness blocks changed-file formatting regressions and keeps the legacy audit informational", async () => {
  const workflow = await readFile(".github/workflows/azure-container-ci.yml", "utf8");
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /run: npm run format:check:changed/u);
  assert.match(
    workflow,
    /name: Legacy repository formatting audit[\s\S]{0,160}continue-on-error: true[\s\S]{0,160}run: npm run format:check/u,
  );
});

test("Playwright aggregation requires complete validated reports before merging", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const reportJob = workflow.slice(
    workflow.indexOf("\n  e2e-report:"),
    workflow.indexOf("\n  isolated-database:"),
  );
  assert.match(reportJob, /needs: release-e2e/u);
  assert.match(reportJob, /name: Validate complete reports before merge/u);
  assert.match(reportJob, /validate-playwright-reports\.py "\$directory" blob-reports/u);
  assert.ok(
    reportJob.indexOf("validate-playwright-reports.py") <
      reportJob.indexOf("npx playwright merge-reports"),
  );
  assert.doesNotMatch(reportJob, /skipping report merge|steps\.reports\.outputs\.available/u);
  assert.match(reportJob, /name: Upload merged Playwright report[\s\S]*?if-no-files-found: error/u);
});

test("generated database contracts must remain committed and deterministic", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(
    workflow,
    /git diff --exit-code -- release-migrations\.json database-contract\.json/u,
  );
});

test("Supabase CLI state and generated local secrets cannot be committed accidentally", async () => {
  const ignore = await readFile(".gitignore", "utf8");
  assert.match(ignore, /^supabase\/\.temp\/$/mu);
  assert.match(ignore, /^supabase\/\.branches\/$/mu);
});
