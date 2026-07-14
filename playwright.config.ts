import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for KovaGPT responsive smoke tests.
 * The Lovable sandbox already runs the Vite dev server on :8080, so we
 * point Playwright at it directly instead of spawning one.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "iphone-small",
      use: { ...devices["iPhone SE (3rd generation)"] ?? devices["iPhone SE"] },
    },
    { name: "iphone-standard", use: { ...devices["iPhone 13"] } },
    { name: "iphone-large", use: { ...devices["iPhone 14 Pro Max"] } },
    { name: "android-phone", use: { ...devices["Pixel 7"] } },
    { name: "ipad-portrait", use: { ...devices["iPad (gen 7)"] } },
    { name: "ipad-landscape", use: { ...devices["iPad (gen 7) landscape"] } },
    {
      name: "tablet-large",
      use: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false },
    },
    {
      name: "desktop-narrow",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-standard",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-large",
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
});
