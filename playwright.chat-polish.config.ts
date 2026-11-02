import { defineConfig } from "@playwright/test";
import rounded from "./playwright.rounded.config";
export default defineConfig({
  ...rounded,
  testMatch: "chat-polish.spec.ts",
  outputDir: "test-results/chat-polish",
});
