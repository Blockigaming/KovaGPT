import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("browser CI uses the Node preview without changing the production preset", async () => {
  const [viteConfig, workflow] = await Promise.all([
    read("vite.config.ts"),
    read(".github/workflows/ci.yml"),
  ]);
  const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("\n  browser:"));
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

  assert.doesNotMatch(verifyJob, /KOVA_BROWSER_PREVIEW/);
  assert.match(verifyJob, /- name: Production build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(verifyJob, /- name: Bundle budget(?:\s+if:[^\n]+)?\s+run: npm run release:bundle/);
  assert.match(verifyJob, /- name: Release checks(?:\s+if:[^\n]+)?\s+run: npm run test:release/);

  // Inspect the production artifact before runtime tests are allowed to replace or remove dist.
  const productionBuildIndex = verifyJob.indexOf("      - name: Production build");
  const bundleBudgetIndex = verifyJob.indexOf("      - name: Bundle budget");
  const integrationIndex = verifyJob.indexOf("      - name: Integration tests");
  assert.ok(productionBuildIndex >= 0);
  assert.ok(bundleBudgetIndex > productionBuildIndex);
  assert.ok(integrationIndex > bundleBudgetIndex);

  assert.match(browserJob, /env:\s+KOVA_BROWSER_PREVIEW: "node"/);
  assert.match(
    browserJob,
    /if: needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/,
  );
  assert.match(browserJob, /- name: Browser preview build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(
    browserJob,
    /run: npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\} --workers=2/,
  );
  assert.match(releaseE2eJob, /env:\s+KOVA_BROWSER_PREVIEW: "node"/);
  assert.match(
    releaseE2eJob,
    /if: needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/,
  );
  assert.match(
    releaseE2eJob,
    /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/3 --reporter=blob --workers=2/,
  );
});
