import { defineConfig, type PlaywrightTestProject } from "@playwright/test";

// Run one engine at a time in CI; local --project can select individual sizes.
const engine = process.env.KOVA_INTERFACE_ENGINE;
if (engine && !["chromium", "firefox", "webkit"].includes(engine))
  throw new Error(`Unknown interface audit engine: ${engine}`);
const scope = process.env.KOVA_INTERFACE_AUDIT_SCOPE ?? "workspace";
if (!["workspace", "public"].includes(scope))
  throw new Error(`Unknown interface audit scope: ${scope}`);

export default defineConfig({
  testDir: "./tests",
  testMatch:
    scope === "workspace"
      ? [
          "**/interface-fit/interface-fit-audit.spec.ts",
          "**/interface-fit/interactive-forms-ui.spec.ts",
          "**/e2e/sidebar-touch-selection.spec.ts",
        ]
      : "**/interface-fit/interface-fit-audit.spec.ts",
  timeout: 60_000,
  // Nine sizes per engine include controlled loading and retry scenarios.
  globalTimeout: 720_000,
  workers: 3,
  retries: 0,
  outputDir: `test-results/interface-fit/${scope}-${engine ?? "all"}/screenshots`,
  reporter: [
    ["list"],
    ["json", { outputFile: `test-results/interface-fit/${scope}-${engine ?? "all"}/results.json` }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4189",
    serviceWorkers: "block",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/azure/local-preview.mjs --duration-ms=900000",
    url: "http://127.0.0.1:4189/api/health",
    timeout: 20_000,
    reuseExistingServer: false,
  },
  projects: (
    [
      {
        name: "chromium-320",
        use: {
          browserName: "chromium",
          viewport: { width: 320, height: 700 },
          isMobile: true,
          hasTouch: true,
        },
      },
      {
        name: "chromium-390",
        use: {
          browserName: "chromium",
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        },
      },
      {
        name: "chromium-short-phone",
        use: {
          browserName: "chromium",
          viewport: { width: 320, height: 480 },
          isMobile: true,
          hasTouch: true,
        },
      },
      {
        name: "chromium-landscape",
        use: {
          browserName: "chromium",
          viewport: { width: 844, height: 390 },
          isMobile: true,
          hasTouch: true,
        },
      },
      {
        name: "chromium-768",
        use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true },
      },
      {
        name: "chromium-1024",
        use: { browserName: "chromium", viewport: { width: 1024, height: 768 }, hasTouch: true },
      },
      {
        name: "chromium-1440",
        use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
      },
      {
        name: "chromium-2560",
        use: { browserName: "chromium", viewport: { width: 2560, height: 1440 } },
      },
      {
        name: "chromium-short-desktop",
        use: { browserName: "chromium", viewport: { width: 1440, height: 390 } },
      },
      ...(["firefox", "webkit"] as const).flatMap((browserName) => [
        {
          name: `${browserName}-320`,
          use: {
            browserName,
            viewport: { width: 320, height: 700 },
            isMobile: browserName === "webkit",
            hasTouch: true,
          },
        },
        {
          name: `${browserName}-390`,
          use: {
            browserName,
            viewport: { width: 390, height: 844 },
            isMobile: browserName === "webkit",
            hasTouch: true,
          },
        },
        {
          name: `${browserName}-short-phone`,
          use: {
            browserName,
            viewport: { width: 320, height: 480 },
            isMobile: browserName === "webkit",
            hasTouch: true,
          },
        },
        {
          name: `${browserName}-landscape`,
          use: {
            browserName,
            viewport: { width: 844, height: 390 },
            isMobile: browserName === "webkit",
            hasTouch: true,
          },
        },
        {
          name: `${browserName}-768`,
          use: { browserName, viewport: { width: 768, height: 1024 }, hasTouch: true },
        },
        {
          name: `${browserName}-1024`,
          use: { browserName, viewport: { width: 1024, height: 768 }, hasTouch: true },
        },
        {
          name: `${browserName}-1440`,
          use: { browserName, viewport: { width: 1440, height: 900 } },
        },
        {
          name: `${browserName}-2560`,
          use: { browserName, viewport: { width: 2560, height: 1440 } },
        },
        {
          name: `${browserName}-short-desktop`,
          use: { browserName, viewport: { width: 1440, height: 390 } },
        },
      ]),
    ] satisfies PlaywrightTestProject[]
  ).filter((project) => !engine || project.name.startsWith(`${engine}-`)),
});
