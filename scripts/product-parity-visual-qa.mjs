import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.env.PREVIEW_URL ?? "http://127.0.0.1:8080";
const outputDirectory = "artifacts/product-parity";
mkdirSync(outputDirectory, { recursive: true });

const cases = [
  ...[320, 390, 768, 1280, 1440, 1920].flatMap((width) =>
    ["light", "dark"].map((theme) => ({
      name: `signed-out-chat-${width}-${theme}`,
      route: "/",
      width,
      theme,
    })),
  ),
  { name: "projects-empty-mobile", route: "/projects", width: 390, theme: "light" },
  { name: "library-empty-tablet", route: "/library", width: 768, theme: "dark" },
  { name: "images-empty-desktop", route: "/images", width: 1440, theme: "dark" },
  { name: "apps-directory-wide", route: "/apps", width: 1920, theme: "light" },
];

const browser = await chromium.launch({ headless: true });
const results = [];
for (const testCase of cases) {
  const page = await browser.newPage({
    viewport: { width: testCase.width, height: testCase.width < 600 ? 844 : 900 },
    colorScheme: testCase.theme,
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_FAILED"))
      consoleErrors.push(message.text());
  });
  await page.route(
    (url) => !url.href.startsWith(baseUrl),
    (route) => route.abort(),
  );
  await page.addInitScript((theme) => {
    localStorage.setItem("vite-ui-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, testCase.theme);

  const response = await page.goto(`${baseUrl}${testCase.route}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(250);
  await page.keyboard.press("Tab");
  const metrics = await page.evaluate(() => {
    const active = document.activeElement;
    const controls = [...document.querySelectorAll("button, a, input, textarea, select")];
    const unnamedControls = controls.filter((control) => {
      if (
        control.getAttribute("aria-hidden") === "true" ||
        (control instanceof HTMLInputElement && ["file", "hidden"].includes(control.type)) ||
        getComputedStyle(control).display === "none" ||
        getComputedStyle(control).visibility === "hidden"
      )
        return false;
      return !(
        control.getAttribute("aria-label") ||
        control.getAttribute("aria-labelledby") ||
        control.getAttribute("title") ||
        control.textContent?.trim() ||
        (control instanceof HTMLInputElement && control.placeholder)
      );
    }).length;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      mainLandmarks: document.querySelectorAll("main, [role='main']").length,
      h1Count: document.querySelectorAll("h1").length,
      activeElement: active?.tagName ?? null,
      activeName:
        active?.getAttribute("aria-label") ?? active?.textContent?.trim().slice(0, 80) ?? null,
      unnamedControls,
    };
  });
  const file = `${outputDirectory}/${testCase.name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  results.push({
    ...testCase,
    status: response?.status() ?? null,
    overflow: metrics.scrollWidth > metrics.clientWidth,
    ...metrics,
    consoleErrors,
    file,
  });
  await page.close();
}
await browser.close();

const failures = results.filter(
  (result) =>
    (result.status !== null && result.status >= 500) ||
    result.overflow ||
    result.mainLandmarks === 0 ||
    result.consoleErrors.length > 0,
);
const evidence = {
  checkedAt: new Date().toISOString(),
  referenceScope:
    "KovaGPT deterministic signed-out and protected-route states; no live account used",
  screenshots: results.length,
  failures: failures.length,
  results,
};
writeFileSync(
  "docs/product-parity/application-visual-results.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify({ screenshots: results.length, failures }, null, 2));
if (failures.length) process.exit(1);
