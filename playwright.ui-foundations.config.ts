import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui-foundations",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/ui-foundations/results",
  reporter: [["list"], ["json", { outputFile: "test-results/ui-foundations/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npx --no-install vite preview --config tests/ui-foundations/vite.config.ts --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
