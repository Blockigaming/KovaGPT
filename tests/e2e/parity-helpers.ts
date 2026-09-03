import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const VIEWPORTS = [
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
] as const;

export const STYLE_PROPERTIES = [
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
] as const;

export const ELEMENT_MAP = {
  applicationRoot: { chatgpt: "#__next", kova: "body" },
  mainWorkspace: { chatgpt: "main", kova: "main" },
  sidebarShell: { chatgpt: "nav", kova: ".kova-sidebar" },
  topBar: { chatgpt: "header", kova: ".kova-topbar" },
  modelSelector: {
    chatgpt: "[data-testid='model-switcher-dropdown-button']",
    kova: "[aria-label*='model' i]",
  },
  openSidebar: { chatgpt: "[aria-label='Open sidebar']", kova: "[aria-label='Open sidebar']" },
  collapseSidebar: {
    chatgpt: "[aria-label='Close sidebar']",
    kova: "[aria-label='Collapse sidebar']",
  },
  newChat: { chatgpt: "[data-testid='create-new-chat-button']", kova: "[aria-label='New chat']" },
  search: { chatgpt: "[aria-label='Search chats']", kova: "[aria-label='Search chats']" },
  emptyGreeting: { chatgpt: "main h1", kova: "main h1" },
  composer: { chatgpt: "form", kova: ".kova-composer" },
  composerInput: { chatgpt: "#prompt-textarea", kova: "textarea" },
  sendControl: {
    chatgpt: "[data-testid='send-button']",
    kova: "[data-testid='send-button']",
  },
  transcript: { chatgpt: "main [role='presentation']", kova: "[data-chat-transcript]" },
} as const;

export type CaptureMetadata = {
  url: string;
  viewport: { width: number; height: number };
  dpr: number;
  theme: string;
  pointer: string;
  authentication: string;
  applicationState: string;
  captureTimestamp: string;
  commitSha: string;
  zoom: number;
  reducedMotion: boolean;
};

export async function stablePage(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
  });
}

export async function makeContext(
  browser: Browser,
  options: {
    viewport: { width: number; height: number };
    dpr: number;
    theme: "light" | "dark";
    reducedMotion: boolean;
    pointer: "fine" | "coarse";
    storageState?: string;
  },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.dpr,
    colorScheme: options.theme,
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
    hasTouch: options.pointer === "coarse",
    storageState: options.storageState,
  });
  await context.addInitScript(
    ({ pointer }) => {
      const native = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query.includes("pointer:")
          ? ({
              matches: query.includes(pointer),
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent: () => false,
            } as MediaQueryList)
          : native(query);
    },
    { pointer: options.pointer },
  );
  return context;
}

export async function collectStyles(page: Page, site: "chatgpt" | "kova") {
  return page.evaluate(
    ({ map, properties, siteName }) =>
      Object.fromEntries(
        Object.entries(map).map(([name, selectors]) => {
          const selector = selectors[siteName as keyof typeof selectors];
          const element = document.querySelector(selector);
          if (!element) return [name, { selector, present: false }];
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const svg = element.matches("svg") ? element : element.querySelector("svg");
          return [
            name,
            {
              selector,
              present: true,
              box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              styles: Object.fromEntries(
                properties.map((property) => [
                  property,
                  style[property as keyof CSSStyleDeclaration] ?? "",
                ]),
              ),
              icon: svg
                ? {
                    box: (() => {
                      const r = svg.getBoundingClientRect();
                      return { x: r.x, y: r.y, width: r.width, height: r.height };
                    })(),
                    viewBox: svg.getAttribute("viewBox"),
                    strokeWidth: getComputedStyle(svg).strokeWidth,
                  }
                : null,
            },
          ];
        }),
      ),
    { map: ELEMENT_MAP, properties: STYLE_PROPERTIES, siteName: site },
  );
}

export async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

export async function recordMotion(
  page: Page,
  selector: string,
  action: () => Promise<void>,
  milliseconds = 400,
) {
  const recording = page.evaluate(
    ({ selector, milliseconds }) =>
      new Promise<unknown[]>((resolve) => {
        const frames: unknown[] = [];
        const start = performance.now();
        const sample = (now: number) => {
          const node = document.querySelector(selector);
          if (node) {
            const box = node.getBoundingClientRect();
            const css = getComputedStyle(node);
            frames.push({
              t: now - start,
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
              transform: css.transform,
              opacity: css.opacity,
              background: css.backgroundColor,
              shadow: css.boxShadow,
              border: css.border,
            });
          }
          if (now - start < milliseconds) requestAnimationFrame(sample);
          else resolve(frames);
        };
        requestAnimationFrame(sample);
      }),
    { selector, milliseconds },
  );
  await action();
  return recording;
}
