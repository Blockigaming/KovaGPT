import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Day 16 browser matrix covers required widths, engines, themes, and auth states", () => {
  const config = readFileSync("playwright.release.config.ts", "utf8");
  const spec = readFileSync("tests/release-browser/final-matrix.spec.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1728]) {
    assert.match(config, new RegExp(`\\[${width},`), `missing ${width}px`);
  }
  for (const engine of ["chromium", "firefox", "webkit"])
    assert.match(config, new RegExp(engine, "u"));
  assert.match(spec, /\["light", "dark"\]/u);
  assert.match(spec, /critical public and authenticated routes/u);
  assert.match(spec, /production API failure boundaries remain truthful/u);
  assert.match(pkg.scripts["test:e2e:release:signed-out"], /playwright\.release\.config/u);
  assert.match(pkg.scripts["test:e2e:release:signed-in"], /KOVA_RELEASE_AUTHENTICATED=1/u);
  assert.match(config, /externalBaseUrl/u);
});
