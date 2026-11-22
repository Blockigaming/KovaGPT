import { defineConfig } from "@playwright/test";

const browserSuite = process.env.KOVA_BROWSER_SUITE ?? "all";
if (!["all", "core", "public"].includes(browserSuite)) {
  throw new Error(`Unknown KOVA_BROWSER_SUITE: ${browserSuite}`);
}
const publicSuitePatterns = [
  "**/public-surface-matrix.spec.ts",
  "**/public-detail-pages.spec.ts",
  "**/writing-tools.spec.ts",
  "**/translation-family.spec.ts",
];

const usePrebuiltPreview = process.env.PLAYWRIGHT_PREBUILT === "1";

/**
 * Playwright config for KovaGPT responsive smoke and visual checks.
 * PLAYWRIGHT_BASE_URL can override the conventional local preview-server URL.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: [
    "**/auth-visual-regression.spec.ts",
    "**/deployed-baseline-audit.spec.ts",
    "**/azure-node-runtime.spec.ts",
    ...(browserSuite === "core" ? publicSuitePatterns : []),
  ],
  ...(browserSuite === "public" ? { testMatch: publicSuitePatterns } : {}),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  webServer: {
    command: [
      ...(usePrebuiltPreview ? [] : ["npm run build"]),
      "npm run preview -- --host 127.0.0.1 --port 4189",
    ].join(" && "),
    url: "http://127.0.0.1:4189",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4189",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  // Compact projects exercise narrow CSS viewports at 1:1. The web desktop
  // layout test separately opens the app in actual mobile viewport mode.
  projects: [
    {
      name: "phone-320x700",
      use: { viewport: { width: 320, height: 700 }, hasTouch: true },
    },
    {
      name: "phone-375x812",
      use: { viewport: { width: 375, height: 812 }, hasTouch: true },
    },
    {
      name: "phone-390x844",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: "phone-412x915",
      use: { viewport: { width: 412, height: 915 }, hasTouch: true },
    },
    {
      name: "phone-430x932",
      use: { viewport: { width: 430, height: 932 }, hasTouch: true },
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
