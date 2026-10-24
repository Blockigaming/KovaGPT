import { defineConfig } from "@playwright/test";
import rounded from "./playwright.rounded.config";

export default defineConfig({
  ...rounded,
  testMatch: "core-app-review.spec.ts",
  timeout: 60000,
  outputDir: "test-results/core-review",
  use: { ...rounded.use, actionTimeout: 10000 },
});
