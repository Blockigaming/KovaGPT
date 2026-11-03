import { defineConfig } from "@playwright/test";
import actual from "./playwright.config";
export default defineConfig({
  ...actual,
  testMatch: [
    "**/signed-out-runtime-qa.spec.ts",
    "**/auth-entry-and-dialog.spec.ts",
    "**/settings-theme-transition.spec.ts",
    "**/public-shell.spec.ts",
  ],
  projects: actual.projects?.filter((project) =>
    new Set(["phone-390x844", "desktop-1440x900"]).has(project.name!),
  ),
  workers: 1,
  timeout: 45000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "public-website-regression-report", open: "never" }],
  ],
  webServer: {
    ...actual.webServer,
    command: "npm run preview -- --host 127.0.0.1 --port 4189",
    reuseExistingServer: false,
  },
});
