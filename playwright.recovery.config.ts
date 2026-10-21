import { defineConfig } from "@playwright/test";
import base from "./playwright.rounded.config";
export default defineConfig({
  ...base,
  testMatch: ["recovery-*.spec.ts", "core-app-review.spec.ts"],
  timeout: 60000,
  outputDir: "test-results/recovery",
  reporter: [["list"], ["json", { outputFile: "test-results/recovery-results.json" }]],
  use: { ...base.use, actionTimeout: 8000 },
  webServer: { ...base.webServer, command: "node scripts/azure/local-preview.mjs" },
});
