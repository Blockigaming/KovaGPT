import { defineConfig } from "@playwright/test";
import production from "./playwright.production.config";
export default defineConfig({
  ...production,
  testMatch: "pr560-live-mobile.spec.ts",
  retries: 0,
  workers: 1,
  projects: [
    {
      name: "iPhone-390x844",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "Android-412x915",
      use: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
    },
  ],
});
