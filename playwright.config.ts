import { defineConfig } from "@playwright/test";

const usePrebuiltPreview = process.env.PLAYWRIGHT_PREBUILT === "1";

/**
 * Playwright config for KovaGPT responsive smoke and visual checks.
 * PLAYWRIGHT_BASE_URL can override the conventional local preview-server URL.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/auth-visual-regression.spec.ts", "**/deployed-baseline-audit.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  webServer: {
    command: [
      ...(usePrebuiltPreview ? [] : ["npm run build"]),
      "npm run preview -- --host 127.0.0.1 --port 8080",
    ].join(" && "),
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "phone-320x700",
      use: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true },
    },
    {
      name: "phone-375x812",
      use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
    {
      name: "phone-390x844",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "phone-412x915",
      use: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
    },
    {
      name: "phone-430x932",
      use: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true },
    },
    { name: "tablet-768x1024", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    {
      name: "phone-landscape-844x390",
      use: { viewport: { width: 844, height: 390 }, hasTouch: true },
    },
    { name: "tablet-1024x768", use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: "desktop-1280x800", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1440x900", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1728x1117", use: { viewport: { width: 1728, height: 1117 } } },
  ],
});
