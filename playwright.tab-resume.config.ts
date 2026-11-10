import { defineConfig } from "@playwright/test";
import base from "./playwright.interface-fit.config";

export default defineConfig({
  ...base,
  testMatch: "**/performance/tab-return-continuity.spec.ts",
  workers: 1,
  outputDir: "test-results/tab-resume",
  reporter: [["list"], ["json", { outputFile: "test-results/tab-resume/results.json" }]],
  projects: [
    {
      name: "five-browser-sessions",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
  ],
});
