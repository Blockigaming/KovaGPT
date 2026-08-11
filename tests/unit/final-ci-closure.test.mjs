import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Worker smoke test disables unavailable AI providers without weakening runtime validation", async () => {
  const source = await readFile("tests/integration/production-worker-artifact.test.mjs", "utf8");
  assert.match(source, /AI_GENERATION_ENABLED: "false"/u);
  assert.match(source, /AZURE_ENVIRONMENT: "ci"/u);
  assert.match(source, /Worker did not become healthy/u);
});

test("Azure readiness blocks changed-file formatting regressions and keeps the legacy audit informational", async () => {
  const workflow = await readFile(".github/workflows/azure-container-ci.yml", "utf8");
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /run: npm run format:check:changed/u);
  assert.match(
    workflow,
    /name: Legacy repository formatting audit\s+continue-on-error: true\s+run: npm run format:check/u,
  );
});

test("Playwright report aggregation exits cleanly when source jobs produce no blob reports", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /name: Detect blob reports/u);
  assert.match(workflow, /find blob-reports -type f -name '\*\.zip'/u);
  assert.match(
    workflow,
    /name: Merge Playwright reports\s+if: steps\.reports\.outputs\.available == 'true'/u,
  );
  assert.match(
    workflow,
    /name: Upload merged Playwright report\s+if: steps\.reports\.outputs\.available == 'true'/u,
  );
});

test("Supabase CLI state and generated local secrets cannot be committed accidentally", async () => {
  const ignore = await readFile(".gitignore", "utf8");
  assert.match(ignore, /^supabase\/\.temp\/$/mu);
  assert.match(ignore, /^supabase\/\.branches\/$/mu);
});
