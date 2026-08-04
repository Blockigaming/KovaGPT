import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const config = await readFile("playwright.config.ts", "utf8");

const requiredViewports = [
  "width: 320, height: 700",
  "width: 375, height: 812",
  "width: 390, height: 844",
  "width: 412, height: 915",
  "width: 430, height: 932",
  "width: 844, height: 390",
  "width: 768, height: 1024",
  "width: 1024, height: 768",
  "width: 1280, height: 800",
  "width: 1440, height: 900",
  "width: 1728, height: 1117",
];

test("Playwright config names the required responsive QA viewports", () => {
  for (const viewport of requiredViewports) assert.match(config, new RegExp(viewport));
});
