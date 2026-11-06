import { defineConfig } from "@playwright/test";
process.env.PLAYWRIGHT_BASE_URL ??= "http://127.0.0.1:4191";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "owner-ui-polish.spec.ts",
  timeout: 45000,
  expect: { timeout: 12000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4191",
    url: "http://127.0.0.1:4191",
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "small-phone",
      use: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true },
    },
  ],
});
