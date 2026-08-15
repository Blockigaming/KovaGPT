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
  const browserJob = workflow.slice(workflow.indexOf("\n  browser:"));

  assert.match(
    viteConfig,
    /const useNodeBrowserPreview = process\.env\.KOVA_BROWSER_PREVIEW === "node";/,
  );
  assert.match(viteConfig, /preset: useNodeBrowserPreview \? "node-server" : "cloudflare-module"/);
  assert.match(viteConfig, /cloudflare: \{ nodeCompat: true, deployConfig: true \}/);

  assert.doesNotMatch(verifyJob, /KOVA_BROWSER_PREVIEW/);
  assert.match(verifyJob, /- name: Production build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(browserJob, /env:\s+KOVA_BROWSER_PREVIEW: "node"/);
  assert.match(browserJob, /- name: Browser preview build(?:\s+if:[^\n]+)?\s+run: npm run build/);
  assert.match(
    browserJob,
    /run: npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\}/,
  );
});
