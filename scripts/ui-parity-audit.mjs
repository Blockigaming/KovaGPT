#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(process.env.PARITY_OUTPUT || path.join(root, "artifacts/ui-parity"));
const targets = {
  chatgpt: process.env.CHATGPT_URL || "https://chatgpt.com",
  kova: process.env.KOVAGPT_URL || "https://kovagpt.com",
};
const widths = [320, 360, 375, 390, 412, 430, 768, 820, 1024, 1280, 1366, 1440, 1512, 1728];
const heights = {
  320: 700,
  360: 800,
  375: 812,
  390: 844,
  412: 915,
  430: 932,
  768: 1024,
  820: 1180,
  1024: 768,
  1280: 800,
  1366: 768,
  1440: 900,
  1512: 982,
  1728: 1117,
};
const defaultScenarios = [
  { id: "empty-chat", path: "/" },
  { id: "images", path: "/images" },
  { id: "library", path: "/library" },
];
const styleProperties = [
  "display",
  "position",
  "inset",
  "zIndex",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "padding",
  "gap",
  "overflow",
  "overflowX",
  "overflowY",
  "alignItems",
  "justifyContent",
  "gridTemplateColumns",
  "flexDirection",
  "flexWrap",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textDecoration",
  "textTransform",
  "whiteSpace",
  "color",
  "backgroundColor",
  "backgroundImage",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "filter",
  "backdropFilter",
  "transform",
  "transformOrigin",
  "cursor",
  "pointerEvents",
  "transitionProperty",
  "transitionDuration",
  "transitionTimingFunction",
  "transitionDelay",
  "animationName",
  "animationDuration",
  "animationTimingFunction",
  "animationDelay",
  "animationIterationCount",
  "animationFillMode",
  "outline",
  "outlineOffset",
  "scrollBehavior",
  "scrollSnapType",
  "touchAction",
  "userSelect",
];
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const scenarios = process.env.PARITY_SCENARIOS
  ? JSON.parse(process.env.PARITY_SCENARIOS)
  : defaultScenarios;
const matrix = (quick ? [1280] : widths).flatMap((width) =>
  (quick ? ["light"] : ["light", "dark"]).map((theme) => ({
    width,
    height: heights[width],
    theme,
  })),
);

const dirs = ["screenshots", "diffs", "snapshots", "motion", "reports"];
await Promise.all(dirs.map((dir) => mkdir(path.join(output, dir), { recursive: true })));
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const generatedAt = new Date().toISOString();
const captures = [];
const errors = [];
const comparisons = [];

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function deepDiff(left, right, pointer = "") {
  if (Object.is(left, right)) return [];
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return [{ path: pointer || "/", chatgpt: left, kova: right }];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((key) =>
    deepDiff(
      left[key],
      right[key],
      `${pointer}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    ),
  );
}

async function snapshot(page) {
  return page.evaluate(
    ({ styleProperties }) => {
      const selector = (element) => {
        const chunks = [];
        for (
          let node = element;
          node?.nodeType === 1 && chunks.length < 8;
          node = node.parentElement
        ) {
          let chunk = node.localName;
          if (node.id) chunk += `#${CSS.escape(node.id)}`;
          else {
            const siblings = node.parentElement
              ? [...node.parentElement.children].filter((x) => x.localName === node.localName)
              : [];
            if (siblings.length > 1) chunk += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
          chunks.unshift(chunk);
        }
        return chunks.join(" > ");
      };
      const visible = (element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const elements = [...document.querySelectorAll("body *")]
        .filter(visible)
        .map((element, index) => {
          const style = getComputedStyle(element),
            rect = element.getBoundingClientRect();
          const attributes = Object.fromEntries(
            [...element.attributes]
              .filter(
                ({ name }) =>
                  name === "role" ||
                  name === "tabindex" ||
                  name.startsWith("aria-") ||
                  name === "disabled",
              )
              .map(({ name, value }) => [name, value]),
          );
          return {
            index,
            path: selector(element),
            tag: element.localName,
            role: element.getAttribute("role") || element.localName,
            text: (element.childElementCount ? "" : element.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 160),
            attributes,
            rect: Object.fromEntries(
              ["x", "y", "width", "height", "top", "right", "bottom", "left"].map((key) => [
                key,
                Math.round(rect[key] * 100) / 100,
              ]),
            ),
            styles: Object.fromEntries(
              styleProperties.map((property) => [property, style[property] || ""]),
            ),
            svg:
              element instanceof SVGElement
                ? {
                    viewBox: element.getAttribute("viewBox"),
                    d: element.getAttribute("d"),
                    points: element.getAttribute("points"),
                    fill: element.getAttribute("fill"),
                    stroke: element.getAttribute("stroke"),
                  }
                : undefined,
          };
        });
      const focusOrder = [
        ...document.querySelectorAll("a[href],button,input,textarea,select,[tabindex]"),
      ]
        .filter((element) => visible(element) && !element.disabled && element.tabIndex >= 0)
        .sort((a, b) => (a.tabIndex || 10_000) - (b.tabIndex || 10_000))
        .map((element) => ({
          path: selector(element),
          role: element.getAttribute("role") || element.localName,
          name:
            element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 100) || "",
          tabIndex: element.tabIndex,
        }));
      return {
        url: location.href,
        title: document.title,
        locale: document.documentElement.lang,
        scroll: {
          x: scrollX,
          y: scrollY,
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        },
        elements,
        focusOrder,
        landmarks: [
          ...document.querySelectorAll("header,nav,main,aside,footer,[role=dialog],[role=menu]"),
        ].map((element) => ({
          path: selector(element),
          role: element.getAttribute("role") || element.localName,
          label: element.getAttribute("aria-label") || "",
        })),
        animations: document.getAnimations().map((animation) => ({
          target: animation.effect?.target ? selector(animation.effect.target) : null,
          playState: animation.playState,
          timing: animation.effect?.getTiming(),
          keyframes: animation.effect
            ?.getKeyframes?.()
            .map(({ offset, easing, composite, ...frame }) => ({
              offset,
              easing,
              composite,
              ...frame,
            })),
        })),
        performance: performance
          .getEntriesByType("navigation")
          .map(
            ({
              domComplete,
              domContentLoadedEventEnd,
              loadEventEnd,
              responseEnd,
              startTime,
              transferSize,
              decodedBodySize,
            }) => ({
              domComplete,
              domContentLoadedEventEnd,
              loadEventEnd,
              responseEnd,
              startTime,
              transferSize,
              decodedBodySize,
            }),
          ),
        shifts: performance
          .getEntriesByType("layout-shift")
          .map((entry) => ({
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            startTime: entry.startTime,
          })),
      };
    },
    { styleProperties },
  );
}

async function interactionSnapshot(page) {
  return page.evaluate(async () => {
    const results = [];
    const targets = [
      ...document.querySelectorAll("button,a[href],[role=button],[role=menuitem],input,textarea"),
    ]
      .filter((element) => {
        const r = element.getBoundingClientRect(),
          s = getComputedStyle(element);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
      })
      .slice(0, 100);
    for (const element of targets) {
      const label =
        element.getAttribute("aria-label") ||
        element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
        element.localName;
      const states = {};
      for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) {
        element.dispatchEvent(new PointerEvent(type, { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const style = getComputedStyle(element);
        states[type] = {
          color: style.color,
          backgroundColor: style.backgroundColor,
          opacity: style.opacity,
          transform: style.transform,
          cursor: style.cursor,
        };
      }
      results.push({
        label,
        role: element.getAttribute("role") || element.localName,
        disabled: Boolean(element.disabled),
        states,
      });
    }
    return results;
  });
}

async function pixelDiff(browser, left, right, destination) {
  const page = await browser.newPage({ viewport: { width: 1, height: 1 } });
  const result = await page.evaluate(
    async ({ left, right }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const [a, b] = await Promise.all([load(left), load(right)]);
      const width = Math.max(a.width, b.width),
        height = Math.max(a.height, b.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(a, 0, 0);
      const ad = context.getImageData(0, 0, width, height).data;
      context.clearRect(0, 0, width, height);
      context.drawImage(b, 0, 0);
      const bd = context.getImageData(0, 0, width, height).data;
      const diff = context.createImageData(width, height);
      let changed = 0,
        absoluteError = 0;
      for (let i = 0; i < ad.length; i += 4) {
        const delta = Math.max(
          Math.abs(ad[i] - bd[i]),
          Math.abs(ad[i + 1] - bd[i + 1]),
          Math.abs(ad[i + 2] - bd[i + 2]),
          Math.abs(ad[i + 3] - bd[i + 3]),
        );
        if (delta) changed++;
        absoluteError += delta;
        diff.data[i] = 255;
        diff.data[i + 1] = delta ? 0 : 255;
        diff.data[i + 2] = delta ? 255 : 255;
        diff.data[i + 3] = delta ? 255 : 30;
      }
      context.putImageData(diff, 0, 0);
      return {
        width,
        height,
        changedPixels: changed,
        totalPixels: width * height,
        changedRatio: changed / (width * height),
        meanAbsoluteError: absoluteError / (width * height),
        image: canvas.toDataURL("image/png").split(",")[1],
      };
    },
    {
      left: `data:image/png;base64,${left.toString("base64")}`,
      right: `data:image/png;base64,${right.toString("base64")}`,
    },
  );
  await writeFile(destination, Buffer.from(result.image, "base64"));
  await page.close();
  delete result.image;
  return result;
}

const browser = await chromium.launch();
for (const authentication of [
  "anonymous",
  ...(process.env.CHATGPT_STORAGE_STATE && process.env.KOVAGPT_STORAGE_STATE
    ? ["authenticated"]
    : []),
]) {
  for (const scenario of scenarios)
    for (const viewport of matrix) {
      const pair = {};
      const id = `${authentication}-${scenario.id}-${viewport.width}x${viewport.height}-${viewport.theme}`;
      for (const [site, baseUrl] of Object.entries(targets)) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: viewport.theme,
          hasTouch: viewport.width < 1024,
          storageState:
            authentication === "authenticated"
              ? process.env[`${site.toUpperCase()}_STORAGE_STATE`]
              : undefined,
        });
        const page = await context.newPage();
        const startedAt = performance.now();
        try {
          const response = await page.goto(
            new URL(scenario[site]?.path || scenario.path, baseUrl).href,
            { waitUntil: "domcontentloaded", timeout: 45_000 },
          );
          await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "no response"}`);
          if (scenario[site]?.prepare) await page.evaluate(scenario[site].prepare);
          const data = await snapshot(page);
          const interactions = await interactionSnapshot(page);
          const screenshot = await page.screenshot({ fullPage: true });
          await writeFile(path.join(output, "screenshots", `${site}-${id}.png`), screenshot);
          await writeFile(
            path.join(output, "snapshots", `${site}-${id}.json`),
            JSON.stringify({ ...data, interactions }, null, 2) + "\n",
          );
          pair[site] = { data: { ...data, interactions }, screenshot };
          captures.push({
            id: `${site}-${id}`,
            site,
            authentication,
            scenario: scenario.id,
            viewport,
            finalUrl: page.url(),
            durationMs: Math.round(performance.now() - startedAt),
            status: "captured",
          });
        } catch (error) {
          const failure = {
            id: `${site}-${id}`,
            site,
            authentication,
            scenario: scenario.id,
            viewport,
            url: page.url(),
            error: clean(error.message),
            status: "failed",
          };
          captures.push(failure);
          errors.push(failure);
        } finally {
          await context.close();
        }
      }
      if (pair.chatgpt && pair.kova) {
        const differences = deepDiff(pair.chatgpt.data, pair.kova.data);
        const visual = await pixelDiff(
          browser,
          pair.chatgpt.screenshot,
          pair.kova.screenshot,
          path.join(output, "diffs", `${id}.png`),
        );
        const comparison = {
          id,
          authentication,
          scenario: scenario.id,
          viewport,
          differenceCount: differences.length,
          differences,
          visual,
        };
        comparisons.push(comparison);
        await writeFile(
          path.join(output, "diffs", `${id}.json`),
          JSON.stringify(comparison, null, 2) + "\n",
        );
      }
    }
}
await browser.close();
const completedPairs = comparisons.length;
const totalDifferences = comparisons.reduce((sum, item) => sum + item.differenceCount, 0);
const changedPixels = comparisons.reduce((sum, item) => sum + item.visual.changedPixels, 0);
const totalPixels = comparisons.reduce((sum, item) => sum + item.visual.totalPixels, 0);
const report = {
  schemaVersion: 2,
  generatedAt,
  commitSha,
  targets,
  requestedPairs:
    matrix.length *
    scenarios.length *
    (process.env.CHATGPT_STORAGE_STATE && process.env.KOVAGPT_STORAGE_STATE ? 2 : 1),
  completedPairs,
  captures,
  errors,
  metrics: {
    totalDifferences,
    changedPixels,
    totalPixels,
    visualParity: totalPixels ? 1 - changedPixels / totalPixels : null,
  },
  comparisons,
};
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify({ schemaVersion: 2, generatedAt, commitSha, captures }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      output,
      requestedPairs: report.requestedPairs,
      completedPairs,
      errors: errors.length,
      totalDifferences,
      visualParity: report.metrics.visualParity,
    },
    null,
    2,
  ),
);
if (errors.length || completedPairs !== report.requestedPairs) process.exitCode = 2;
