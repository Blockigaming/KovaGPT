import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Azure build explicitly selects Node and retains the normal build gates", () => {
  assert.equal(pkg.scripts["build:azure"], "KOVA_BROWSER_PREVIEW=node npm run build");
  for (const name of ["build", "build:dev"]) {
    assert.match(
      pkg.scripts[name],
      /node --max-old-space-size=3072 node_modules\/vite\/bin\/vite\.js build/u,
    );
    assert.match(
      pkg.scripts[name],
      /&& node work-runner\/build\.mjs && npm run release:zero-lovable:built$/u,
    );
  }
  const workflow = readFileSync(".github/workflows/azure-container-ci.yml", "utf8");
  assert.match(workflow, /name: Production build[\s\S]*?run: npm run build:azure/u);
});

test("Azure build does not change the existing Cloudflare deployment default", () => {
  const vite = readFileSync("vite.config.ts", "utf8");
  assert.match(vite, /preset: useNodeBrowserPreview \? "node-server" : "cloudflare-module"/u);
  assert.doesNotMatch(pkg.scripts["build:azure"], /az |wrangler |deploy|push/u);
});

test("Azure CI runs for its runtime verification inputs, including large PRs", () => {
  const workflow = readFileSync(".github/workflows/azure-container-ci.yml", "utf8");
  const classification = workflow.split("\n").find((line) => line.includes("grep -Eq '"));
  assert.ok(classification);
  for (const path of [
    "playwright.azure.config.ts",
    "tests/e2e/azure-node-runtime.spec.ts",
    "tests/e2e/authenticated-fixture.ts",
    "tests/e2e/hydration.ts",
    "tests/fixtures/azure-local-network-guard.mjs",
    "tests/unit/azure-build-entry.test.mjs",
    "tests/unit/azure-local-isolation.test.mjs",
  ]) {
    const result = spawnSync(
      "bash",
      ["-euo", "pipefail", "-c", `files=$(cat)\n${classification}\nexit 0\nelse\nexit 9\nfi`],
      {
        input: [
          path,
          ...Array.from({ length: 20000 }, (_, i) => `src/generated/path-${i}.ts`),
        ].join("\n"),
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(result.status, 0, `${path}: Azure CI skipped its own verification input`);
  }
});
