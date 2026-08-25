import { defineConfig, type Project } from "@playwright/test";

const authenticated = process.env.KOVA_RELEASE_AUTHENTICATED === "1";
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const storageState = process.env.KOVA_RELEASE_AUTH_STATE;
if (authenticated && !storageState) {
  throw new Error("KOVA_RELEASE_AUTH_STATE is required for the authenticated release matrix");
}

// Minimum supported release viewport contract: width: 320, height: 700.
// DAY16_REQUIRED_VIEWPORT_CONTRACT_START
// Required release viewport: width: 320
// Required release viewport: width: 375
// Required release viewport: width: 390
// Required release viewport: width: 768
// Required release viewport: width: 1024
// Required release viewport: width: 1280
// Required release viewport: width: 1440
// Required release viewport: width: 1728
// DAY16_REQUIRED_VIEWPORT_CONTRACT_END
const viewports = [
  [320, 700],
  [375, 812],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1728, 1117],
] as const;
const engines = ["chromium", "firefox", "webkit"] as const;

const projects: Project[] = engines.flatMap((browserName) =>
  viewports.map(([width, height]) => ({
    name: `${authenticated ? "signed-in" : "signed-out"}-${browserName}-${width}`,
    metadata: { authenticated, browserName, width, height },
    use: {
      browserName,
      viewport: { width, height },
      isMobile: width <= 390,
      hasTouch: width <= 1024,
      storageState: authenticated ? storageState : undefined,
    },
  })),
);

export default defineConfig({
  testDir: "./tests/release-browser",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? 3 : 4,
  reporter: [
    ["list"],
    [
      "junit",
      {
        outputFile: `artifacts/release/browser-matrix-${authenticated ? "signed-in" : "signed-out"}.xml`,
      },
    ],
    ["html", { outputFolder: "artifacts/release-browser-report", open: "never" }],
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run preview -- --host 127.0.0.1 --port 8080",
        url: "http://127.0.0.1:8080",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  use: {
    baseURL: externalBaseUrl || "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    reducedMotion: "reduce",
  },
  projects,
  outputDir: "artifacts/release-browser-results",
});
