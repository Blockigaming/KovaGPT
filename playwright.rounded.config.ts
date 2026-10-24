import { defineConfig } from "@playwright/test";

// Exercises the actual built application. Synthetic account data lives only
// in the browser test; the existing Node runner strips credentials and egress.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "rounded-actual-app.spec.ts",
  timeout: 45000,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/rounded",
  webServer: {
    command: "node scripts/azure/local-preview.mjs",
    url: "http://127.0.0.1:4189/api/health",
    reuseExistingServer: false,
    timeout: 20000,
  },
  use: {
    baseURL: "http://127.0.0.1:4189",
    serviceWorkers: "block",
    reducedMotion: "reduce",
    launchOptions: process.env.KOVA_TEST_CHROMIUM_PATH
      ? { executablePath: process.env.KOVA_TEST_CHROMIUM_PATH }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
