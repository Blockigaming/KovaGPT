import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

// The digest-pinned Playwright Noble image contains the required browsers and
// Ubuntu native libraries. Fail closed on missing binaries, mismatched versions,
// or any browser that cannot actually start and render a document.
const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.packages[""].devDependencies["@playwright/test"], "1.56.0");
assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, "/ms-playwright");

const engines = { chromium, firefox, webkit };
const requested = process.argv.slice(2);
assert.ok(requested.length > 0, "Specify at least one required browser engine");
for (const engine of requested) {
  assert.ok(Object.hasOwn(engines, engine), `Unexpected browser engine: ${engine}`);
  const browser = await engines[engine].launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Kova native browser verification</title>");
    assert.equal(await page.title(), "Kova native browser verification");
    console.log(`Native browser verified: ${engine}`);
  } finally {
    await browser.close();
  }
}
