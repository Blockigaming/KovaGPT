import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.RELEASE_BASE_URL || "http://127.0.0.1:3000";
const viewports = [
  [320, 568],
  [360, 800],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1512, 982],
  [1728, 1117],
  [1920, 1080],
];
const themes = ["light", "dark", "no-preference"];
const routes = ["/", "/features", "/apps", "/images", "/maps", "/assistants", "/ar/home"];
await mkdir("artifacts/release-visual-matrix", { recursive: true });
const cases = [];
for (const [viewportIndex, [width, height]] of viewports.entries()) {
  for (const [themeIndex, theme] of themes.entries()) {
    const route = routes[(viewportIndex + themeIndex) % routes.length];
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width, height },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await page.keyboard.press("Tab");
    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      focusedText: document.activeElement?.textContent?.trim() || "",
      h1Count: document.querySelectorAll("h1").length,
      direction: getComputedStyle(document.documentElement).direction,
      maxContentWidth: Math.max(
        ...[...document.querySelectorAll("main")].map(
          (element) => element.getBoundingClientRect().width,
        ),
        0,
      ),
    }));
    const name = `${width}x${height}-${theme}-${route.replaceAll("/", "-") || "home"}`;
    cases.push({
      name,
      route,
      width,
      height,
      theme,
      reducedMotion: true,
      status: response?.status() || 0,
      ...facts,
      result:
        response?.status() === 200 &&
        !facts.overflow &&
        facts.h1Count === 1 &&
        /skip to content/iu.test(facts.focusedText)
          ? "pass"
          : "fail",
    });
    await page.close();
    await browser.close();
  }
}
const failures = cases.filter(({ result }) => result === "fail");
await writeFile(
  "docs/release-reconciliation/visual-matrix-report.json",
  `${JSON.stringify({ generatedAt: "2026-08-12", browser: "Chromium", physicalAssistiveTechnology: false, safari: false, caseCount: cases.length, passCount: cases.length - failures.length, failCount: failures.length, cases }, null, 2)}\n`,
);
console.log({ cases: cases.length, failures: failures.map(({ name }) => name) });
if (failures.length) process.exitCode = 1;
