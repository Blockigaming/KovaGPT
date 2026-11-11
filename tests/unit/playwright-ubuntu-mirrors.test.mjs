import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const helperPath = "scripts/ci/install-playwright-with-mirror-fallback.sh";

test("Playwright dependencies retain signed Ubuntu mirrors and bounded fallback", () => {
  execFileSync("bash", ["-n", helperPath]);
  const helper = readFileSync(helperPath, "utf8");
  assert.match(helper, /https:\/\/archive\.ubuntu\.com\/ubuntu\//);
  assert.match(helper, /https:\/\/azure\.archive\.ubuntu\.com\/ubuntu\//);
  assert.match(helper, /https:\/\/security\.ubuntu\.com\/ubuntu\//);
  assert.match(helper, /original_mirrors/);
  assert.match(helper, /timeout --signal=TERM --kill-after=10s 360s/);
  assert.match(helper, /playwright install --with-deps "\$@"/);
  assert.doesNotMatch(helper, /--allow-unauthenticated|--force-yes|trusted=yes|--no-sandbox/);
});

test("browser release workflows use the version-matched Playwright container", () => {
  const { devDependencies } = JSON.parse(readFileSync("package.json", "utf8"));
  const image = `mcr.microsoft.com/playwright:v${devDependencies["@playwright/test"]}-noble`;
  const workflows = [
    [".github/workflows/assistant-ui-browser.yml", 4],
    [".github/workflows/ci.yml", 4],
    [".github/workflows/interface-fit-audit.yml", 1],
  ];
  for (const [path, expected] of workflows) {
    const source = readFileSync(path, "utf8");
    const images = Array.from(source.matchAll(/^\s+image: (\S+)$/gm), ([, value]) => value);
    const calls = source.match(/bash scripts\/ci\/install-playwright-browsers\.sh/g) ?? [];
    assert.deepEqual(images, Array(expected).fill(image), path);
    assert.equal(calls.length, expected, path);
    assert.doesNotMatch(
      source,
      /install-playwright-with-mirror-fallback|playwright install --with-deps/,
    );
  }
});
