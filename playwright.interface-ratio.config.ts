import { defineConfig } from "@playwright/test";
import { KOVA_APP_USER_AGENT } from "./tests/e2e/app-surface";

const engine = process.env.KOVA_MOBILE_STATE_ENGINE;
if (engine && !["chromium", "firefox", "webkit"].includes(engine))
  throw new Error(`Unknown mobile state engine: ${engine}`);

// Rendered ratio contracts and frozen desktop geometry, using synthetic data.
export default defineConfig({
  testDir: "./tests/interface-ratio",
  // Cross-engine state runs do not compare Chromium's frozen font geometry.
  ...(engine ? { testMatch: ["mobile-states.spec.ts", "startup.spec.ts"] } : {}),
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/interface-ratio",
  use: {
    baseURL: "http://127.0.0.1:4189",
    browserName: (engine ?? "chromium") as "chromium" | "firefox" | "webkit",
    serviceWorkers: "block",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    // Firefox's touch event emulation alone retains a mouse media query.
    // Gecko LookAndFeel defines 1 as Coarse, 2 as Fine, and 4 as Hover.
    ...(engine === "firefox"
      ? {
          launchOptions: {
            firefoxUserPrefs: {
              "ui.primaryPointerCapabilities": 1,
              "ui.allPointerCapabilities": 1,
            },
          },
        }
      : {}),
  },
  webServer: {
    command: "node scripts/azure/local-preview.mjs --duration-ms=600000",
    url: "http://127.0.0.1:4189/api/health",
    timeout: 20_000,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    ...[
      { width: 320, height: 700 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ].map((viewport) => ({
      name: `phone-${viewport.width}`,
      // Phone ratios describe the native app presentation.
      use: {
        viewport,
        isMobile: engine !== "firefox",
        hasTouch: true,
        userAgent: KOVA_APP_USER_AGENT,
      },
    })),
    {
      name: "landscape-844",
      use: {
        viewport: { width: 844, height: 390 },
        isMobile: engine !== "firefox",
        hasTouch: true,
        userAgent: KOVA_APP_USER_AGENT,
      },
    },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
});
