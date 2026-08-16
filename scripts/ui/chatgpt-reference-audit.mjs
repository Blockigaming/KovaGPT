import { chromium, firefox, webkit } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const kovaOrigin = process.env.KOVA_PREVIEW_ORIGIN ?? "http://127.0.0.1:8080";
const referenceOrigin = process.env.CHATGPT_REFERENCE_ORIGIN ?? "https://chatgpt.com";
const outputRoot = process.env.KOVA_PARITY_OUTPUT ?? "artifacts/chatgpt-reference-audit";
const widths = [320, 375, 390, 768, 1024, 1280, 1440, 1728];
const themes = ["light", "dark"];
const engines = { chromium, firefox, webkit };
mkdirSync(outputRoot, { recursive: true });

function roundBox(box) {
  if (!box) return null;
  return Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)]));
}

async function measure(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const textarea = [...document.querySelectorAll("textarea")].find(visible);
    const nav = [...document.querySelectorAll("aside,nav")].find(visible);
    const main = [...document.querySelectorAll("main")].find(visible);
    const buttons = [...document.querySelectorAll("button")].filter(visible);
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      title: document.title,
      url: location.href,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      textarea: rect(textarea),
      navigation: rect(nav),
      main: rect(main),
      visibleButtonCount: buttons.length,
      unnamedVisibleButtons: buttons.filter((button) => {
        const label = button.getAttribute("aria-label") ?? button.getAttribute("title") ?? button.textContent ?? "";
        return !label.trim();
      }).length,
      voiceTextVisible: /\b(?:Voice|Dictate)\b/u.test(document.body.innerText),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      fontFamily: getComputedStyle(document.body).fontFamily,
    };
  });
}

function geometryDelta(reference, kova) {
  const fields = ["textarea", "navigation", "main"];
  const result = {};
  for (const field of fields) {
    if (!reference[field] || !kova[field]) {
      result[field] = null;
      continue;
    }
    result[field] = Object.fromEntries(
      ["x", "y", "width", "height"].map((key) => [key, Math.round(kova[field][key] - reference[field][key])]),
    );
  }
  return result;
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  referenceOrigin,
  kovaOrigin,
  notice: "Rendered screenshots and geometry only. No reference source code or protected assets are copied.",
  cases: [],
};

for (const [engineName, engine] of Object.entries(engines)) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const theme of themes) {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: width < 768 ? 812 : 900 }, colorScheme: theme });
        const reference = await context.newPage();
        const kova = await context.newPage();
        const caseName = `${engineName}-${theme}-${width}`;
        try {
          await reference.goto(referenceOrigin, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await kova.goto(kovaOrigin, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await reference.screenshot({ path: join(outputRoot, `${caseName}-reference.png`), fullPage: true });
          await kova.screenshot({ path: join(outputRoot, `${caseName}-kova.png`), fullPage: true });
          const referenceMetrics = await measure(reference);
          const kovaMetrics = await measure(kova);
          report.cases.push({
            caseName,
            engine: engineName,
            theme,
            width,
            status: "captured",
            reference: { ...referenceMetrics, textarea: roundBox(referenceMetrics.textarea), navigation: roundBox(referenceMetrics.navigation), main: roundBox(referenceMetrics.main) },
            kova: { ...kovaMetrics, textarea: roundBox(kovaMetrics.textarea), navigation: roundBox(kovaMetrics.navigation), main: roundBox(kovaMetrics.main) },
            geometryDelta: geometryDelta(referenceMetrics, kovaMetrics),
          });
        } catch (error) {
          report.cases.push({ caseName, engine: engineName, theme, width, status: "failed", error: error instanceof Error ? error.message : String(error) });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

writeFileSync(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const failed = report.cases.filter((entry) => entry.status !== "captured");
if (failed.length) {
  console.error(`CHATGPT_REFERENCE_AUDIT=PARTIAL failed=${failed.length} total=${report.cases.length}`);
  process.exit(2);
}
console.log(`CHATGPT_REFERENCE_AUDIT=PASS cases=${report.cases.length}`);
