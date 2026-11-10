import { defineConfig } from "@playwright/test";
import base from "./playwright.interface-fit.config";

const engine = process.env.KOVA_INTERFACE_ENGINE ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error("Unknown loading engine");
const loadingBrowser = engine as "chromium" | "firefox" | "webkit";
const reportScope = process.env.KOVA_LOADING_REPORT_SCOPE ?? "all";
if (!["all", "loading", "activation"].includes(reportScope))
  throw new Error("Unknown loading report scope");

export default defineConfig({
  ...base,
  testMatch: "**/performance/*.spec.ts",
  workers: 1,
  outputDir: `test-results/interface-fit/tab-resume/${reportScope}/screenshots`,
  reporter: [
    ["list"],
    ["json", { outputFile: `test-results/interface-fit/tab-resume/${reportScope}/results.json` }],
  ],
  projects: [
    ...[
      { name: "loading-desktop", viewport: { width: 1280, height: 800 }, isMobile: false },
      { name: "loading-mobile", viewport: { width: 390, height: 844 }, isMobile: true },
    ].map(({ name, viewport, isMobile }) => ({
      name,
      testMatch: "**/performance/loading-experience.spec.ts",
      use: {
        browserName: loadingBrowser,
        viewport,
        isMobile: isMobile && loadingBrowser !== "firefox",
        hasTouch: isMobile,
      },
    })),
    {
      name: "five-browser-sessions",
      testMatch: "**/performance/tab-return-continuity.spec.ts",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "native-tab-activation",
      testMatch: "**/performance/native-tab-return.spec.ts",
      use: {
        browserName: "chromium",
        headless: false,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
