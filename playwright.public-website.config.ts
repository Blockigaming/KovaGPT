import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "public-website-approval.spec.ts",
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "public-website-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4189",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4189",
    url: "http://127.0.0.1:4189",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
