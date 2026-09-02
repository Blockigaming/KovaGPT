import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("browser CI uses the Node preview without changing the production preset", async () => {
  const [viteConfig, workflow, parity, shellParity, productionAudit] = await Promise.all([
    read("vite.config.ts"),
    read(".github/workflows/ci.yml"),
    read("tests/e2e/chatgpt-parity.spec.ts"),
    read("tests/e2e/chatgpt-shell-parity.spec.ts"),
    read("tests/e2e/production-audit.spec.ts"),
  ]);
  const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("\n  browser:"));
  const browserJob = workflow.slice(
    workflow.indexOf("\n  browser:"),
    workflow.indexOf("\n  release-e2e:"),
  );
  const releaseJob = workflow.slice(
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
  assert.match(browserJob, /- name: Browser preview build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(
    browserJob,
    /run: npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\}/,
  );
  assert.match(releaseJob, /env:\s+KOVA_BROWSER_PREVIEW: "node"/);
  assert.match(
    releaseJob,
    /npm run test:e2e -- --project=desktop-1440x900 --shard=\$\{\{ matrix\.shard \}\}\/3 --reporter=blob/,
  );
  for (const source of [parity, shellParity]) {
    assert.match(source, /const selfEnumeratingProject = "desktop-1440x900"/);
    assert.match(source, /testInfo\.project\.name !== selfEnumeratingProject/);
  }
  assert.match(productionAudit, /const routeBatches = Array\.from/);
  assert.match(productionAudit, /routes\.slice\(index \* 8, index \* 8 \+ 8\)/);
  assert.match(productionAudit, /test\.setTimeout\(45_000\)/);
});
