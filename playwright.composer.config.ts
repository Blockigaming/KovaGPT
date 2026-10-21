import { defineConfig } from "@playwright/test";
import rounded from "./playwright.rounded.config";

// Uses the actual production build with browser-only synthetic fixtures.
export default defineConfig({
  ...rounded,
  testMatch: "composer-actual-app.spec.ts",
  timeout: 30000,
  outputDir: "test-results/composer",
});
