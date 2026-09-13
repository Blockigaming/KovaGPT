import { defineConfig } from "@playwright/test";
const host = "127.0.0.1",
  port = 8187,
  baseURL = `http://${host}:${port}`;
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "library-version-history.spec.ts",
  timeout: 45000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/e2e/auth-visual-preview.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240000,
    env: { KOVA_AUTH_VISUAL_HOST: host, KOVA_AUTH_VISUAL_PORT: String(port) },
  },
});
