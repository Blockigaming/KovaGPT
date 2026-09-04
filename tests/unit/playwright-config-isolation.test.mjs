import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRootFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the general Playwright matrix excludes dedicated QA specs", async () => {
  const [generalConfig, authVisualConfig, deployedAuditConfig] = await Promise.all([
    readRootFile("playwright.config.ts"),
    readRootFile("playwright.auth-visual.config.ts"),
    readRootFile("playwright.deployed-audit.config.ts"),
  ]);

  assert.match(
    generalConfig,
    /testIgnore:\s*\[\s*"\*\*\/auth-visual-regression\.spec\.ts",\s*"\*\*\/deployed-baseline-audit\.spec\.ts",?\s*\]/u,
  );
  assert.match(authVisualConfig, /testMatch:\s*"auth-visual-regression\.spec\.ts"/u);
  assert.match(deployedAuditConfig, /testMatch:\s*"deployed-baseline-audit\.spec\.ts"/u);
});
