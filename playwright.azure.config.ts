import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "azure-node-runtime.spec.ts",
  timeout: 30000,
  globalTimeout: 150000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/azure-node",
  webServer: {
    command: "node scripts/azure/local-preview.mjs",
    url: "http://127.0.0.1:4189/api/health",
    timeout: 20000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: "http://127.0.0.1:4189",
    browserName: "chromium",
    ...(process.env.KOVA_TEST_CHROME_CHANNEL === "chrome" ? { channel: "chrome" } : {}),
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "off",
  },
});
