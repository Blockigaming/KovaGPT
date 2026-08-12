import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("artifacts/page-parity", { recursive: true });
const browser = await chromium.launch({ headless: true });
const widths = [320, 390, 768, 1280, 1440, 1920];
const routes = [
  "/about",
  "/developers",
  "/engineering",
  "/apps/collaboration",
  "/assistants/study-coach",
  "/acceptable-use",
];
const results = [];
const consoleErrors = [];
for (const theme of ["light", "dark"])
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i],
      route = routes[i];
    const page = await browser.newPage({
      viewport: { width, height: Math.min(1080, Math.max(720, Math.round(width * 0.7))) },
      colorScheme: theme,
    });
    await page.route(
      (url) => !url.href.startsWith("http://127.0.0.1:8080"),
      (route) => route.abort(),
    );
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("ERR_FAILED"))
        consoleErrors.push({ theme, width, route, text: m.text() });
    });
    await page.addInitScript((value) => {
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.style.colorScheme = value;
    }, theme);
    const response = await page.goto("http://127.0.0.1:8080" + route, {
      waitUntil: "domcontentloaded",
    });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      h1: document.querySelectorAll("h1").length,
      active: document.activeElement?.tagName,
    }));
    await page.keyboard.press("Tab");
    const focusVisible = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e) return false;
      const s = getComputedStyle(e);
      return (
        e.tagName === "A" &&
        (s.position === "fixed" || s.outlineStyle !== "none" || s.boxShadow !== "none")
      );
    });
    const file = `artifacts/page-parity/${theme}-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    results.push({
      theme,
      width,
      route,
      status: response?.status(),
      ...metrics,
      focusVisible,
      overflow: metrics.scrollWidth > metrics.clientWidth,
      file,
    });
    await page.close();
  }
await browser.close();
writeFileSync(
  "docs/page-parity/visual-results.json",
  JSON.stringify(
    { checkedAt: "2026-08-11", screenshots: results.length, results, consoleErrors },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      screenshots: results.length,
      overflow: results.filter((r) => r.overflow),
      badH1: results.filter((r) => r.h1 !== 1),
      consoleErrors,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.overflow || r.h1 !== 1 || r.status >= 500) || consoleErrors.length)
  process.exit(1);
