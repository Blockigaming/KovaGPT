import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "deployed-baseline-audit.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  outputDir: "artifacts/ui-audit/deployed-baseline/playwright",
  use: {
    browserName: "chromium",
    colorScheme: "light",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "deployed-phone-390x844",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        contextOptions: {
          reducedMotion: "reduce",
          screen: { width: 390, height: 844 },
        },
      },
    },
    {
      name: "deployed-desktop-1440x900",
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        contextOptions: {
          reducedMotion: "reduce",
          screen: { width: 1440, height: 900 },
        },
      },
    },
  ],
});
