import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser and production builds use the same Azure-compatible Node runtime", async () => {
  const [vite, workflow, releaseConfig] = await Promise.all([
    readFile("vite.config.ts", "utf8"),
    readFile(".github/workflows/final-release-ci.yml", "utf8"),
    readFile("playwright.release.config.ts", "utf8"),
  ]);
  assert.match(vite, /preset:\s*"node-server"/u);
  assert.doesNotMatch(vite, /KOVA_BROWSER_PREVIEW|cloudflare-module/u);
  assert.match(workflow, /npm run test:e2e/u);
  for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1728]) {
    assert.match(
      releaseConfig,
      new RegExp(`width:\\s*${width}`, "u"),
      `missing ${width}px viewport`,
    );
  }
  assert.match(releaseConfig, /chromium/iu);
  assert.match(releaseConfig, /firefox/iu);
  assert.match(releaseConfig, /webkit/iu);
});
