import { defineConfig } from "@playwright/test";

const host = "127.0.0.1";
const port = 8081;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "auth-visual-regression.spec.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  webServer: {
    command: "node tests/e2e/auth-visual-preview.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      KOVA_AUTH_VISUAL_HOST: host,
      KOVA_AUTH_VISUAL_PORT: String(port),
      VITE_SUPABASE_URL: baseURL,
      VITE_SUPABASE_PUBLISHABLE_KEY: "auth-visual-public-key",
    },
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "phone-390x844",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-1440x900",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
