import { defineConfig } from "@playwright/test";
import base from "./playwright.interface-fit.config";

export default defineConfig({
  ...base,
  testMatch: "**/performance/*tab-return*.spec.ts",
  workers: 1,
  outputDir: "test-results/interface-fit/tab-resume/screenshots",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/interface-fit/tab-resume/results.json" }],
  ],
  projects: [
    {
      name: "five-browser-sessions",
      testMatch: "**/performance/tab-return-continuity.spec.ts",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "native-tab-activation",
      testMatch: "**/performance/native-tab-return.spec.ts",
      use: {
        browserName: "chromium",
        headless: false,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
