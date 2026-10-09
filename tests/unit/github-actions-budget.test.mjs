import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { load as parseYaml } from "js-yaml";

const read = (path) => readFile(path, "utf8");

test("superseded CI computations cancel without suppressing current-head evidence", async () => {
  const workflow = parseYaml(await read(".github/workflows/ci.yml"));
  function admits(
    job,
    { cancelled = false, verify = "success", scope = "true", draft = false } = {},
  ) {
    const expression = workflow.jobs[job].if;
    assert.match(expression, /^\$\{\{ !cancelled\(\)/u);
    return runInNewContext(expression.slice(3, -2).trim(), {
      cancelled: () => cancelled,
      needs: { verify: { result: verify, outputs: { run_ci: scope, run_database: scope } } },
      github: { event_name: "pull_request", event: { pull_request: { draft } } },
    });
  }
  for (const job of ["isolated-database", "browser", "release-e2e"]) {
    assert.equal(admits(job), true, `${job} must retain current-head checks`);
    assert.equal(admits(job, { cancelled: true }), false, `${job} must release a cancelled run`);
    assert.equal(admits(job, { scope: "false" }), false, `${job} must retain scope gating`);
  }
  assert.equal(admits("isolated-database", { verify: "failure" }), true);
  for (const job of ["browser", "release-e2e"]) {
    assert.equal(admits(job, { verify: "failure" }), false);
    assert.equal(admits(job, { draft: true }), false);
  }
  const evidence = workflow.jobs["isolated-database"].steps.find(
    (step) => step.name === "Upload upgrade rehearsal evidence",
  );
  assert.equal(evidence.if, "always()", "preserve available failure/cancellation evidence");
});

test("primary CI avoids duplicate branch runs and gates expensive work", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /cancel-in-progress: true/u);
  const checkoutCount = workflow.match(/uses: actions\/checkout@/gu)?.length ?? 0;
  const exactHeadCheckoutCount =
    workflow.match(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/gu)
      ?.length ?? 0;
  assert.equal(checkoutCount, 6);
  assert.equal(
    exactHeadCheckoutCount,
    checkoutCount,
    "every CI checkout must use the immutable PR head instead of GitHub's synthetic merge ref",
  );
  for (const artifact of ["integration-test-log", "deployed-baseline", "candidate-visual"])
    assert.ok(
      workflow.includes(
        `name: ${artifact}-` + "${{ github.event.pull_request.head.sha || github.sha }}",
      ),
      `${artifact} must be labeled with the exact checked-out head`,
    );
  assert.match(workflow, /github\.event\.pull_request\.draft == false/u);
  assert.match(workflow, /branches:\s+- main/u);
  assert.doesNotMatch(workflow, /- work|- "codex\/\*\*"/u);
  assert.doesNotMatch(workflow, /paths(?:-ignore)?:/u);
  assert.match(workflow, /name: Classify changed files/u);
  assert.match(workflow, /grep -Eqv/);
  assert.doesNotMatch(workflow, /grep -Ev[^\n]*\|\s*grep -q/u);
  assert.match(workflow, /name: Repository formatting audit/u);
  assert.doesNotMatch(
    workflow,
    /name: Repository formatting audit[\s\S]{0,120}continue-on-error:\s*true/u,
  );
  assert.match(workflow, /run_database: \$\{\{ steps\.scope\.outputs\.run_database \}\}/u);
  for (const databaseProofPath of [
    "\\.github/workflows/ci\\.yml",
    "release-migration-lineage\\.json",
    "migration-preflight",
    "migration-schema-fingerprint",
    "migration-schema-proof-plan",
    "migration-temp-export-source-proof",
  ]) {
    assert.ok(
      workflow.includes(databaseProofPath),
      `${databaseProofPath} must trigger isolated database CI`,
    );
  }
  assert.match(
    workflow,
    /isolated-database:[\s\S]*?needs\.verify\.outputs\.run_database == 'true'/u,
  );
  assert.match(
    workflow,
    /browser:\s+if: \$\{\{ !cancelled\(\) && needs\.verify\.result == 'success' && needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/u,
  );
  assert.match(
    workflow,
    /release-e2e:\s+if: \$\{\{ !cancelled\(\) && needs\.verify\.result == 'success' && needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/u,
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

test("staging rehearsal retains the pinned migration proof commit", async () => {
  const workflow = await read(".github/workflows/staging-rehearsal.yml");
  const checkout = workflow.match(
    /- uses: actions\/checkout@[\s\S]*?- uses: actions\/setup-node@/u,
  )?.[0];

  assert.ok(checkout, "staging rehearsal must include checkout before setup-node");
  assert.match(checkout, /persist-credentials: false/u);
  assert.match(checkout, /fetch-depth: 0/u);
  assert.match(workflow, /npm run release:validate/u);
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

test("large PR classification preserves the isolated database gate under pipefail", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  const line = workflow
    .split("\n")
    .find((value) => value.includes("if grep -Eq '") && value.includes("supabase/migrations/"));
  assert.ok(line);
  const paths = [
    "supabase/migrations/20260905033500_library_image_storage_quota.sql",
    ...Array.from({ length: 20000 }, (_, i) => `src/generated/long-comparison-path-${i}.ts`),
  ];
  const result = spawnSync(
    "bash",
    ["-euo", "pipefail", "-c", `files=$(cat)\n${line} printf database; else exit 9; fi`],
    { input: paths.join("\n"), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "database");
});
