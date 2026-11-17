import { defineConfig } from "@playwright/test";

// Rendered ratio contracts and frozen desktop geometry, using synthetic data.
export default defineConfig({
  testDir: "./tests/interface-ratio",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/interface-ratio",
  use: {
    baseURL: "http://127.0.0.1:4189",
    browserName: "chromium",
    serviceWorkers: "block",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/azure/local-preview.mjs --duration-ms=600000",
    url: "http://127.0.0.1:4189/api/health",
    timeout: 20_000,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    ...[
      { width: 320, height: 700 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ].map((viewport) => ({
      name: `phone-${viewport.width}`,
      use: { viewport, isMobile: true, hasTouch: true },
    })),
    {
      name: "landscape-844",
      use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
    },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
});
