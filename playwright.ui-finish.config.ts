import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "ui-finish.spec.ts",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "artifacts/ui-finish-report", open: "never" }]],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4190",
    url: "http://127.0.0.1:4190",
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:4190",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "small-phone",
      use: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
