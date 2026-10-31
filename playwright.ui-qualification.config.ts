import { defineConfig } from "@playwright/test";
import actualApp from "./playwright.rounded.config";

process.env.PLAYWRIGHT_BASE_URL ??= "http://127.0.0.1:4189";
const suite = process.env.KOVA_UI_QUALIFICATION_SUITE ?? "finish";
if (!["finish", "core", "controls", "all"].includes(suite))
  throw new Error("Unknown UI qualification suite");
const evidence = process.env.KOVA_UI_EVIDENCE_LABEL ?? suite;
if (!/^[a-z0-9-]+$/u.test(evidence)) throw new Error("Invalid UI evidence label");

export default defineConfig({
  ...actualApp,
  testIgnore: [
    "**/auth-visual-regression.spec.ts",
    "**/deployed-baseline-audit.spec.ts",
    "**/azure-node-runtime.spec.ts",
    "**/public-surface-matrix.spec.ts",
    "**/public-detail-pages.spec.ts",
  ],
  testMatch:
    suite === "all"
      ? "**/*.spec.ts"
      : suite === "core"
        ? [
            "chatgpt-shell-parity.spec.ts",
            "core-app-review.spec.ts",
            "projects-drive-layout.spec.ts",
            "spec400-chat.spec.ts",
            "ui-quality.spec.ts",
            "settings-theme-transition.spec.ts",
            "mobile-quality.spec.ts",
            "desktop-polish.spec.ts",
            "mobile-shell-ui-truth.spec.ts",
            "responsive.spec.ts",
            "production-audit.spec.ts",
            "screenshot-repair-review.spec.ts",
            "final-readiness.spec.ts",
            "functional-reliability.spec.ts",
          ]
        : suite === "controls"
          ? [
              "composer-actual-app.spec.ts",
              "rounded-actual-app.spec.ts",
              "workspace-select-controls.spec.ts",
              "auth-entry-and-dialog.spec.ts",
              "recovery-shell.spec.ts",
            ]
          : [
              "ui-finish.spec.ts",
              "signed-out-runtime-qa.spec.ts",
              "model-selector.spec.ts",
              "work-model-controls.spec.ts",
              "work-browser-takeover.spec.ts",
            ],
  workers: 1,
  outputDir: `test-results/ui-qualification-${evidence}`,
  reporter: [["list"], ["json", { outputFile: `artifacts/ui-qualification-${evidence}.json` }]],
  projects: [
    { name: "desktop-1440x900", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet-1024x768", use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    {
      name: "phone-390x844",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: "phone-320x700",
      use: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true },
    },
  ],
});
