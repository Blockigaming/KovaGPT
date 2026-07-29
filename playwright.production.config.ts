import { defineConfig } from "@playwright/test";

const baseURL = process.env.KOVA_PRODUCTION_URL ?? "https://kovagpt.com";
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;

if (!baseURL.startsWith("https://")) {
  throw new Error("KOVA_PRODUCTION_URL must use HTTPS");
}

/**
 * Live, read-only production verification. Unlike the local Playwright config,
 * this deliberately has no webServer so a passing run can never target a local
 * preview by mistake.
 */
export default defineConfig({
  testDir: "./tests/production",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ...(proxy ? { proxy: { server: proxy } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "production-phone", use: { viewport: { width: 390, height: 844 }, isMobile: true } },
    { name: "production-desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
