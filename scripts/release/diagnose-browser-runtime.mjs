import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { isFatalRuntimeEvent } from "./browser-runtime-events.mjs";

const engines = { chromium, firefox, webkit };
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/u, "").split("=");
    return [key, value.join("=") || "1"];
  }),
);

const engineName = args.get("engine") || "webkit";
const baseUrl = new URL(
  args.get("url") || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8080",
);
const timeoutMs = Number(args.get("timeout-ms") || 30_000);
const settleMs = Number(args.get("settle-ms") || 0);
const outputPath = args.get("output") || "artifacts/release/browser-runtime-diagnostic.json";
const width = Number(args.get("width") || 390);
const height = Number(args.get("height") || 844);
const browserType = engines[engineName];

if (!browserType) {
  throw new Error(`Unsupported engine ${engineName}; expected chromium, firefox, or webkit`);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) {
  throw new Error("timeout-ms must be between 1000 and 180000");
}
if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 60_000) {
  throw new Error("settle-ms must be between 0 and 60000");
}
if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 320) {
  throw new Error("width and height must describe a usable viewport");
}

const events = [];
const startedAt = new Date().toISOString();
const started = Date.now();
let closing = false;
let signalFatal;
const fatalEvent = new Promise((resolveFatal) => {
  signalFatal = resolveFatal;
});

function record(type, detail, url = null) {
  if (closing) return;
  const event = {
    atMs: Date.now() - started,
    type,
    detail: String(detail).slice(0, 4_000),
    ...(url ? { url } : {}),
  };
  events.push(event);
  if (isFatalRuntimeEvent(event, baseUrl.href)) signalFatal();
}

let browser;
let context;
let page;
let navigationError = null;
let state = null;
let documentHeaders = null;

try {
  browser = await browserType.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width, height },
    isMobile: engineName !== "firefox" && width <= 390,
    hasTouch: width <= 1024,
    reducedMotion: "reduce",
  });
  page = await context.newPage();

  page.on("crash", () => record("page_crash", "Browser page crashed"));
  page.on("pageerror", (error) =>
    record("page_error", error?.stack || error?.message || String(error)),
  );
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      record(`console_${message.type()}`, message.text());
    }
  });
  page.on("requestfailed", (request) =>
    record(
      "request_failed",
      `${request.resourceType()} ${request.method()} ${request.failure()?.errorText || "unknown"}`,
      request.url(),
    ),
  );
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const resourceType = response.request().resourceType();
    if (["document", "script", "stylesheet", "fetch", "xhr"].includes(resourceType)) {
      record("http_error", `${response.status()} ${resourceType}`, response.url());
    }
  });

  try {
    const response = await page.goto(baseUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const headers = response?.headers() ?? {};
    documentHeaders = {
      contentSecurityPolicy: headers["content-security-policy"] ?? null,
      strictTransportSecurity: headers["strict-transport-security"] ?? null,
      contentType: headers["content-type"] ?? null,
    };
  } catch (error) {
    navigationError = error instanceof Error ? error.stack || error.message : String(error);
    record("navigation_error", navigationError, baseUrl.href);
  }

  // Wait for the real readiness condition, not an arbitrary eight-second sleep.
  // A fatal resource failure ends the wait immediately and is still recorded.
  const hydration = page
    .waitForFunction(
      () =>
        document.documentElement.dataset.kovaHydration === "ready" &&
        document.readyState === "complete",
      undefined,
      { timeout: timeoutMs },
    )
    .then((handle) => handle.dispose())
    .catch((error) => {
      record("hydration_timeout", error instanceof Error ? error.message : String(error));
    });
  await Promise.race([hydration, fatalEvent]);
  if (settleMs > 0 && !events.some((event) => isFatalRuntimeEvent(event, baseUrl.href))) {
    await page.waitForTimeout(settleMs);
  }

  state = await page.evaluate(() => {
    const html = document.documentElement;
    return {
      hydration: html.getAttribute("data-kova-hydration"),
      ariaBusy: html.getAttribute("aria-busy"),
      readyState: document.readyState,
      title: document.title,
      bodyTextLength: document.body?.innerText?.length ?? 0,
      textareaCount: document.querySelectorAll("textarea").length,
      composerCount: document.querySelectorAll(".kova-composer").length,
      mobileTopbarCount: document.querySelectorAll(".kova-topbar").length,
      moduleScripts: Array.from(document.querySelectorAll('script[type="module"][src]'))
        .map((script) => script.src)
        .slice(0, 30),
    };
  });
} catch (error) {
  record("diagnostic_error", error instanceof Error ? error.stack || error.message : String(error));
} finally {
  // Closing a healthy context can cancel background requests; these are not
  // application failures and must not overwrite the completed diagnostic.
  closing = true;
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

const sameOriginFatalEvents = events.filter((event) => isFatalRuntimeEvent(event, baseUrl.href));
const passed =
  navigationError === null &&
  state?.hydration === "ready" &&
  state?.readyState === "complete" &&
  state?.bodyTextLength > 0 &&
  sameOriginFatalEvents.length === 0;

const evidence = {
  schemaVersion: 2,
  startedAt,
  finishedAt: new Date().toISOString(),
  engine: engineName,
  origin: baseUrl.origin,
  viewport: { width, height },
  timeoutMs,
  settleMs,
  passed,
  navigationError,
  documentHeaders,
  state,
  eventCount: events.length,
  // Kept for existing readers; now includes HTTP-to-HTTPS upgraded resources.
  sameOriginFatalEventCount: sameOriginFatalEvents.length,
  events,
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`BROWSER_RUNTIME_DIAGNOSTIC_ENGINE=${engineName}`);
console.log(`BROWSER_RUNTIME_DIAGNOSTIC_HYDRATION=${state?.hydration ?? "unknown"}`);
console.log(`BROWSER_RUNTIME_DIAGNOSTIC_EVENTS=${events.length}`);
console.log(`BROWSER_RUNTIME_DIAGNOSTIC_FATAL_EVENTS=${sameOriginFatalEvents.length}`);
console.log(`BROWSER_RUNTIME_DIAGNOSTIC_EVIDENCE=${outputPath}`);
console.log(`BROWSER_RUNTIME_DIAGNOSTIC=${passed ? "PASS" : "FAIL"}`);

if (!passed) process.exitCode = 1;
