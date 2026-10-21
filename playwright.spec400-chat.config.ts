import { defineConfig } from "@playwright/test";
import actualApp from "./playwright.rounded.config";

// Only the local, credential-stripped preview and browser-owned fixtures are used.
export default defineConfig({
  ...actualApp,
  testMatch: "spec400-chat.spec.ts",
  outputDir: "test-results/spec400-chat",
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "narrow",
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
    },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "ultrawide", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
