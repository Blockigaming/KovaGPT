import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile("playwright.production.config.ts", "utf8");
const suite = await readFile("tests/production/live-production.spec.ts", "utf8");

test("live verification cannot silently fall back to a local preview", () => {
  assert.match(config, /https:\/\/kovagpt\.com/);
  assert.match(config, /testDir: "\.\/tests\/production"/);
  assert.doesNotMatch(config, /webServer\s*:/);
  assert.match(config, /must use HTTPS/);
});

test("live verification covers runtime failures, headers, overflow, and focus", () => {
  assert.match(suite, /pageerror/);
  assert.match(suite, /console/);
  assert.match(suite, /scrollWidth/);
  assert.match(suite, /permissions-policy/);
  assert.match(suite, /toBeFocused/);
});
