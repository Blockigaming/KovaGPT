import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("browser CI uses the Node preview without changing the production preset", async () => {
  const [viteConfig, workflow, authVisualPreview] = await Promise.all([
    read("vite.config.ts"),
    read(".github/workflows/ci.yml"),
    read("tests/e2e/auth-visual-preview.mjs"),
  ]);
  const verifyJob = workflow.slice(
    workflow.indexOf("  verify:"),
    workflow.indexOf("\n  public-surface:"),
  );
  const browserJob = workflow.slice(
    workflow.indexOf("\n  browser:"),
    workflow.indexOf("\n  release-e2e:"),
  );
  const releaseE2eJob = workflow.slice(
    workflow.indexOf("\n  release-e2e:"),
    workflow.indexOf("\n  e2e-report:"),
  );

  assert.match(
    viteConfig,
    /const useNodeBrowserPreview = process\.env\.KOVA_BROWSER_PREVIEW === "node";/,
  );
  assert.match(viteConfig, /preset: useNodeBrowserPreview \? "node-server" : "cloudflare-module"/);
  assert.match(viteConfig, /cloudflare: \{ nodeCompat: true, deployConfig: true \}/);

  assert.match(verifyJob, /- name: Production build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(verifyJob, /- name: Bundle budget(?:\s+if:[^\n]+)?\s+run: npm run release:bundle/);
  assert.match(
    verifyJob,
    /- name: Browser preview build\s+if: steps\.scope\.outputs\.run_ci == 'true'\s+env:\s+KOVA_BROWSER_PREVIEW: node\s+run: npm run build/,
  );
  assert.match(verifyJob, /- name: Release checks(?:\s+if:[^\n]+)?\s+run: npm run test:release/);

  // Inspect the production artifact before the browser build replaces dist.
  const productionBuildIndex = verifyJob.indexOf("      - name: Production build");
  const bundleBudgetIndex = verifyJob.indexOf("      - name: Bundle budget");
  const integrationIndex = verifyJob.indexOf("      - name: Integration tests");
  const previewBuildIndex = verifyJob.indexOf("      - name: Browser preview build");
  const accessibilityIndex = verifyJob.indexOf("      - name: Accessibility checks");
  assert.ok(productionBuildIndex >= 0);
  assert.ok(bundleBudgetIndex > productionBuildIndex);
  assert.ok(integrationIndex > bundleBudgetIndex);
  assert.ok(previewBuildIndex > integrationIndex);
  assert.ok(accessibilityIndex > previewBuildIndex);
  assert.doesNotMatch(verifyJob.slice(0, previewBuildIndex), /KOVA_BROWSER_PREVIEW/);

  // HOME may precede the preview flag in a pinned container job. Check
  // the job-level environment, not an arbitrary step's environment.
  const jobEnvironment = (job) => job.match(/^    env:\n((?:      [^\n]*\n)*)/m)?.[1] ?? "";
  assert.match(jobEnvironment(browserJob), /^      KOVA_BROWSER_PREVIEW: "node"$/m);
  assert.match(
    browserJob,
    /if: always\(\) && needs\.verify\.result == 'success' && needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/,
  );
  assert.match(browserJob, /- name: Browser preview build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(
    browserJob,
    /run: npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\} --workers=2/,
  );
  assert.match(jobEnvironment(releaseE2eJob), /^      KOVA_BROWSER_PREVIEW: "node"$/m);
  assert.match(
    releaseE2eJob,
    /if: always\(\) && needs\.verify\.result == 'success' && needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/,
  );
  assert.match(
    releaseE2eJob,
    /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/8 --reporter=list,blob --workers=2/,
  );
  // GitHub's container checkout path can differ from github.workspace.
  // The fixture must explicitly trust only the actual candidate checkout.
  assert.ok(
    authVisualPreview.includes(
      '["-c", `safe.directory=${sourceRoot}`, "ls-files", "-z", "--cached"]',
    ),
    "The auth fixture may trust only its exact source working tree",
  );
});
