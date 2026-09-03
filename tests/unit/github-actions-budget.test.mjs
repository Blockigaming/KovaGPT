import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("primary CI avoids duplicate branch runs and gates expensive work", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/u);
  assert.match(workflow, /branches:\s+- main/u);
  assert.doesNotMatch(workflow, /- work|- "codex\/\*\*"/u);
  assert.doesNotMatch(workflow, /paths(?:-ignore)?:/u);
  assert.match(workflow, /name: Classify changed files/u);
  assert.match(workflow, /run_database: \$\{\{ steps\.scope\.outputs\.run_database \}\}/u);
  assert.match(
    workflow,
    /isolated-database:[\s\S]*?needs\.verify\.outputs\.run_database == 'true'/u,
  );
  assert.match(
    workflow,
    /browser:\s+if: needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/u,
  );
  assert.match(
    workflow,
    /release-e2e:\s+if: needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/u,
  );
  assert.match(
    workflow,
    /name: Upload integration test log\s+if: steps\.integration\.outcome == 'failure'/u,
  );
  assert.match(workflow, /name: Upload Playwright report\s+if: failure\(\)/u);
  assert.match(
    workflow,
    /git diff --exit-code -- release-migrations\.json database-contract\.json/u,
  );
});

test("Azure readiness preserves required-check visibility while skipping irrelevant heavy stages", async () => {
  const workflow = await read(".github/workflows/azure-container-ci.yml");
  assert.doesNotMatch(workflow, /paths(?:-ignore)?:/u);
  assert.match(workflow, /name: Classify Azure changes/u);
  assert.match(workflow, /infra\/azure\//u);
  assert.match(workflow, /ca-kovagpt-dev-AutoDeployTrigger/u);
  assert.match(workflow, /src\/routes\/api\/health/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/u);
  assert.match(workflow, /permissions:\s+contents: read/u);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /if: steps\.scope\.outputs\.run == 'true'/u);
});

test("production Azure deployment is manual and confirmation-gated", async () => {
  const workflow = await read(
    ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s*push:/mu);
  assert.match(workflow, /confirm_deploy:/u);
  assert.match(workflow, /Verify ACR push access before building/u);
  assert.match(workflow, /vars\.KOVA_DEV_SUPABASE_PROJECT_REF/u);
  assert.match(workflow, /vars\.KOVA_DEV_SUPABASE_URL/u);
  assert.match(workflow, /secrets\.KOVA_DEV_SUPABASE_PUBLISHABLE_KEY/u);
  assert.match(workflow, /vars\.KOVA_DEV_FORBIDDEN_SUPABASE_PROJECT_REFS/u);
  assert.match(workflow, /dev deployment cannot target a forbidden Supabase project/u);
  assert.doesNotMatch(workflow, /KOVA_PRODUCTION_SUPABASE/u);
});
