#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "artifacts/ui-parity");
const targets = {
  chatgpt: process.env.CHATGPT_URL || "https://chatgpt.com/",
  kova: process.env.KOVAGPT_URL || "https://kovagpt.com/",
};
const viewports = [
  [320, 700],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [600, 960],
  [640, 960],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1512, 982],
  [1728, 1117],
  [1920, 1080],
];
const properties = [
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "alignItems",
  "justifyContent",
  "gridTemplateColumns",
  "gridTemplateRows",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "overflow",
  "overflowX",
  "overflowY",
  "scrollPadding",
  "scrollSnapType",
  "zIndex",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textRendering",
  "webkitFontSmoothing",
  "color",
  "backgroundColor",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderRadius",
  "boxShadow",
  "opacity",
  "backdropFilter",
  "transform",
  "transformOrigin",
  "cursor",
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
];
const map = {
  applicationRoot: { chatgpt: "#__next", kova: "body" },
  mainWorkspace: { chatgpt: "main", kova: "main" },
  sidebarShell: { chatgpt: "nav", kova: ".kova-sidebar" },
  topBar: { chatgpt: "header", kova: ".kova-topbar" },
  emptyGreeting: { chatgpt: "main h1", kova: "main h1" },
  composer: { chatgpt: "form", kova: ".kova-composer" },
  composerInput: { chatgpt: "#prompt-textarea", kova: "textarea" },
  sendControl: { chatgpt: "[data-testid='send-button']", kova: "[aria-label='Send message']" },
};
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const matrix = quick
  ? [
      {
        viewport: viewports[10],
        dpr: 1,
        theme: "light",
        pointer: "fine",
        reducedMotion: false,
        zoom: 100,
      },
    ]
  : viewports.flatMap((viewport) =>
      [1, 2].flatMap((dpr) =>
        ["light", "dark"].map((theme) => ({
          viewport,
          dpr,
          theme,
          pointer: viewport[0] < 1024 ? "coarse" : "fine",
          reducedMotion: false,
          zoom: 100,
        })),
      ),
    );
await Promise.all(
  ["computed-styles", "screenshots", "diffs", "motion"].map((dir) =>
    mkdir(path.join(output, dir), { recursive: true }),
  ),
);
const browser = await chromium.launch();
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const captures = [];
const comparisons = [];
for (const authentication of [
  "anonymous",
  ...(process.env.CHATGPT_STORAGE_STATE && process.env.KOVAGPT_STORAGE_STATE
    ? ["authenticated"]
    : []),
])
  for (const item of matrix) {
    const values = {};
    for (const [site, url] of Object.entries(targets)) {
      const state =
        authentication === "authenticated"
          ? process.env[`${site.toUpperCase()}_STORAGE_STATE`]
          : undefined;
      const context = await browser.newContext({
        viewport: { width: item.viewport[0], height: item.viewport[1] },
        deviceScaleFactor: item.dpr,
        colorScheme: item.theme,
        reducedMotion: item.reducedMotion ? "reduce" : "no-preference",
        hasTouch: item.pointer === "coarse",
        storageState: state,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        Date.now = () => 1770000000000;
      });
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
      });
      if (!response?.ok())
        throw new Error(`${site} baseline failed: HTTP ${response?.status() ?? "no response"}`);
      const id = `${site}-${authentication}-${item.viewport.join("x")}-${item.dpr}x-${item.theme}`;
      await page.screenshot({
        path: path.join(output, "screenshots", `${id}.png`),
        fullPage: true,
      });
      values[site] = await page.evaluate(
        ({ map, properties, site }) =>
          Object.fromEntries(
            Object.entries(map).map(([name, selectors]) => {
              const selector = selectors[site];
              const el = document.querySelector(selector);
              if (!el) return [name, { selector, present: false }];
              const s = getComputedStyle(el),
                r = el.getBoundingClientRect();
              return [
                name,
                {
                  selector,
                  present: true,
                  box: { x: r.x, y: r.y, width: r.width, height: r.height },
                  styles: Object.fromEntries(properties.map((p) => [p, s[p] ?? ""])),
                },
              ];
            }),
          ),
        { map, properties, site },
      );
      captures.push({
        id,
        url: page.url(),
        viewport: { width: item.viewport[0], height: item.viewport[1] },
        dpr: item.dpr,
        theme: item.theme,
        pointer: item.pointer,
        authentication,
        applicationState: "empty-chat",
        captureTimestamp: new Date().toISOString(),
        commitSha,
        zoom: item.zoom,
        reducedMotion: item.reducedMotion,
      });
      await context.close();
    }
    for (const name of Object.keys(map)) {
      const a = values.chatgpt[name],
        b = values.kova[name];
      comparisons.push({
        captureId: `${authentication}-${item.viewport.join("x")}-${item.dpr}x-${item.theme}`,
        element: name,
        chatgpt: a,
        kova: b,
        numericDelta:
          a.present && b.present
            ? Object.fromEntries(Object.keys(a.box).map((k) => [k, b.box[k] - a.box[k]]))
            : null,
        intentionalBranding: false,
        sourceComponent: "semantic element map",
        sourceSelector: b.selector,
        requiredCorrection:
          a.present && b.present
            ? "Resolve every non-zero unexplained value"
            : "Supply or update semantic selector",
        correctionStatus: "open",
      });
    }
  }
await browser.close();
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      chromiumVersion: chromium._revision || "Playwright-managed Chromium",
      captures,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(output, "computed-styles/comparison.json"),
  JSON.stringify({ schemaVersion: 1, comparisons }, null, 2) + "\n",
);
console.log(
  `Captured ${captures.length} pages; wrote ${comparisons.length} semantic comparisons to ${output}`,
);
