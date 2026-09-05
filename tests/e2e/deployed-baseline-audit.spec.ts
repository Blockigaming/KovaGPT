import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Response } from "@playwright/test";

const DEPLOYED_URL = "https://kovagpt.com/";
const OUTPUT_DIRECTORY = "artifacts/ui-audit/deployed-baseline";
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const expectedViewports = new Map([
  ["deployed-phone-390x844", { width: 390, height: 844 }],
  ["deployed-desktop-1440x900", { width: 1440, height: 900 }],
]);

function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split(/[?#]/u, 1)[0];
  }
}

test("records the read-only deployed UI baseline without accepting its defects", async ({
  context,
  page,
}, testInfo) => {
  const initialStorageState = await context.storageState();
  expect(
    initialStorageState,
    "The deployed audit must begin without cookies or origin storage",
  ).toEqual({ cookies: [], origins: [] });

  const blockedWrites: Array<{
    method: string;
    resourceType: string;
    url: string;
    isNavigationRequest: boolean;
  }> = [];
  const observedReads: Array<{
    method: string;
    resourceType: string;
    url: string;
    isNavigationRequest: boolean;
  }> = [];
  const blockedSockets: string[] = [];
  const consoleMessages: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];

  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (READ_ONLY_METHODS.has(method)) {
      observedReads.push({
        method,
        resourceType: request.resourceType(),
        url: redactUrl(request.url()),
        isNavigationRequest: request.isNavigationRequest(),
      });
      await route.continue();
      return;
    }

    blockedWrites.push({
      method,
      resourceType: request.resourceType(),
      url: redactUrl(request.url()),
      isNavigationRequest: request.isNavigationRequest(),
    });
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/u, async (socket) => {
    blockedSockets.push(redactUrl(socket.url()));
    await socket.close({ code: 1008, reason: "Read-only deployed audit" });
  });

  page.on("console", (message) => {
    if (
      message.type() !== "error" &&
      message.type() !== "warning" &&
      !/hydrat/iu.test(message.text())
    ) {
      return;
    }
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 500),
    });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));

  let response: Response | null = null;
  let navigationError: string | null = null;
  try {
    response = await page.goto(DEPLOYED_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } catch (error) {
    navigationError = error instanceof Error ? error.message.slice(0, 500) : "Navigation failed";
  }

  const expectedViewport = expectedViewports.get(testInfo.project.name);
  const viewport = page.viewportSize() ?? expectedViewport ?? { width: 0, height: 0 };

  const hydrationBeforeWait = await page.locator("html").evaluate((html) => ({
    dataKovaHydration: (html as HTMLElement).dataset.kovaHydration ?? null,
    ariaBusy: html.getAttribute("aria-busy"),
  }));
  const shouldWaitForHydration =
    hydrationBeforeWait.dataKovaHydration === "pending" || hydrationBeforeWait.ariaBusy === "true";
  const hydrationWait = shouldWaitForHydration
    ? await page
        .waitForFunction(
          () =>
            document.documentElement.dataset.kovaHydration !== "pending" &&
            document.documentElement.getAttribute("aria-busy") !== "true",
          undefined,
          { timeout: 10_000 },
        )
        .then(() => "settled" as const)
        .catch(() => "timed-out" as const)
    : ("not-pending" as const);
  const hydrationAfterWait = await page.locator("html").evaluate((html) => ({
    dataKovaHydration: (html as HTMLElement).dataset.kovaHydration ?? null,
    ariaBusy: html.getAttribute("aria-busy"),
  }));

  const fontWait = await page.evaluate(async () =>
    Promise.race([
      document.fonts.ready.then(() => "ready" as const),
      new Promise<"timed-out">((resolve) => window.setTimeout(() => resolve("timed-out"), 10_000)),
    ]),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  const documentSnapshot = await page.evaluate((configuredViewport) => {
    const html = document.documentElement;
    const body = document.body;
    const scrollingElement = document.scrollingElement ?? html;
    const rectangle = (element: Element) => {
      const box = element.getBoundingClientRect();
      const round = (value: number) => Math.round(value * 100) / 100;
      return {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
        top: round(box.top),
        right: round(box.right),
        bottom: round(box.bottom),
        left: round(box.left),
        inViewport:
          box.left < window.innerWidth &&
          box.top < window.innerHeight &&
          box.right > 0 &&
          box.bottom > 0,
      };
    };
    const inferredRole = (element: Element) => {
      const explicit = element.getAttribute("role");
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "textarea") return "textbox";
      if (tag === "main") return "main";
      if (tag === "aside") return "complementary";
      if (tag === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        if (["text", "email", "search", "url", "tel", "password"].includes(type)) {
          return "textbox";
        }
      }
      return null;
    };
    const elementSnapshot = (element: Element) => {
      const style = getComputedStyle(element);
      const box = rectangle(element);
      return {
        tagName: element.tagName.toLowerCase(),
        explicitRole: element.getAttribute("role"),
        inferredRole: inferredRole(element),
        id: element.id || null,
        className: typeof element.className === "string" ? element.className.slice(0, 300) : null,
        ariaLabel: element.getAttribute("aria-label"),
        ariaHidden: element.getAttribute("aria-hidden"),
        ariaHaspopup: element.getAttribute("aria-haspopup"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        ariaControls: element.getAttribute("aria-controls"),
        disabled:
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
            ? element.disabled
            : null,
        tabIndex: element instanceof HTMLElement ? element.tabIndex : null,
        text: (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 160),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        cursor: style.cursor,
        visible:
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity) > 0,
        svgCount: element.querySelectorAll("svg").length,
        rectangle: box,
      };
    };
    const snapshots = (selector: string) =>
      [...document.querySelectorAll(selector)].map(elementSnapshot);
    const mainElements = snapshots("main, [role='main']");
    const headingElements = snapshots("h1");
    const heading = document.querySelector("h1");
    const bodyStyle = getComputedStyle(body);
    const headingStyle = heading ? getComputedStyle(heading) : null;

    let composerElements = [...document.querySelectorAll(".kova-composer")];
    if (composerElements.length === 0) {
      const textbox = document.querySelector(
        'textarea[aria-label="Message KovaGPT"], [role="textbox"]',
      );
      const fallback = textbox?.closest("form, [class*='composer']");
      if (fallback) composerElements = [fallback];
    }

    const overflowOffenders = [...body.querySelectorAll("*")]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1))
      .slice(0, 20)
      .map(({ element }) => elementSnapshot(element));

    return {
      title: document.title,
      language: html.lang,
      viewport: {
        configured: configuredViewport,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screen: { width: screen.width, height: screen.height },
        devicePixelRatio: window.devicePixelRatio,
        visualViewport: window.visualViewport
          ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              offsetLeft: window.visualViewport.offsetLeft,
              offsetTop: window.visualViewport.offsetTop,
              scale: window.visualViewport.scale,
            }
          : null,
      },
      landmarks: {
        mainCount: mainElements.length,
        visibleMainCount: mainElements.filter((entry) => entry.visible).length,
        mainElements,
        h1Count: headingElements.length,
        visibleH1Count: headingElements.filter((entry) => entry.visible).length,
        h1Elements: headingElements,
      },
      overflow: {
        html: {
          clientWidth: html.clientWidth,
          scrollWidth: html.scrollWidth,
          clientHeight: html.clientHeight,
          scrollHeight: html.scrollHeight,
          overflowX: getComputedStyle(html).overflowX,
          overflowY: getComputedStyle(html).overflowY,
        },
        body: {
          clientWidth: body.clientWidth,
          scrollWidth: body.scrollWidth,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          overflowX: bodyStyle.overflowX,
          overflowY: bodyStyle.overflowY,
        },
        document: {
          clientWidth: scrollingElement.clientWidth,
          scrollWidth: scrollingElement.scrollWidth,
          horizontalOverflowPixels: Math.max(
            0,
            scrollingElement.scrollWidth - scrollingElement.clientWidth,
          ),
        },
        visibleXOverflowOffenders: overflowOffenders,
      },
      typography: {
        bodyFontFamily: bodyStyle.fontFamily,
        bodyFontSize: bodyStyle.fontSize,
        bodyLineHeight: bodyStyle.lineHeight,
        bodyColor: bodyStyle.color,
        h1FontFamily: headingStyle?.fontFamily ?? null,
        h1FontSize: headingStyle?.fontSize ?? null,
        h1FontWeight: headingStyle?.fontWeight ?? null,
        h1LineHeight: headingStyle?.lineHeight ?? null,
        h1Color: headingStyle?.color ?? null,
      },
      theme: {
        htmlClass: html.className,
        dataTheme: html.getAttribute("data-theme"),
        colorScheme: getComputedStyle(html).colorScheme,
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
      },
      controls: {
        composer: composerElements.map(elementSnapshot),
        messageTextbox: snapshots(
          'textarea[aria-label="Message KovaGPT"], [role="textbox"][aria-label*="message" i]',
        ),
        addButton: snapshots('[aria-label="Add files, tools, or prompts"]'),
        sendButton: snapshots('button[aria-label="Send"]'),
        logIn: snapshots(
          'button[aria-label*="log in" i], a[aria-label*="log in" i], button, a[href*="auth"]',
        ).filter((entry) => /log in|sign in/iu.test(`${entry.ariaLabel ?? ""} ${entry.text}`)),
        mobileMenuButton: snapshots('button[aria-label="Open menu"]'),
        sidebar: snapshots('[aria-label="Primary navigation"], aside'),
      },
      signedOutModelAffordance: snapshots(
        '[data-testid="model-selector-trigger"], .kova-model-trigger, .kova-model-static, [aria-label*="model" i], [aria-haspopup][aria-label*="model" i]',
      ),
    };
  }, viewport);

  const hydrationPattern =
    /hydrat|server rendered|did not match|text content does not match|recoverable|React error #(418|419|421|422|423|424|425)/iu;
  const hydrationConsoleErrors = [
    ...consoleMessages
      .filter((entry) => hydrationPattern.test(entry.text))
      .map((entry) => entry.text),
    ...pageErrors.filter((message) => hydrationPattern.test(message)),
  ];

  const redirectChain: string[] = [];
  let request = response?.request() ?? null;
  while (request) {
    redirectChain.unshift(redactUrl(request.url()));
    request = request.redirectedFrom();
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const artifactStem = testInfo.project.name;
  const screenshotPath = join(OUTPUT_DIRECTORY, `${artifactStem}.png`);
  const jsonPath = join(OUTPUT_DIRECTORY, `${artifactStem}.json`);

  // No styles, font substitutions, or animation mutations are injected into this
  // observational screenshot. Candidate screenshots have their own strict gate.
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const status = response?.status() ?? null;
  const reachability =
    navigationError === null && status !== null && status >= 200 && status < 400
      ? "reachable"
      : "unreachable";

  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        classification: "observational-production-baseline",
        reachability,
        candidateAcceptance: false,
        note: "Semantic and visual observations are evidence only, never pass criteria for the candidate UI.",
        observedAt: new Date().toISOString(),
        targetUrl: DEPLOYED_URL,
        finalUrl: redactUrl(page.url()),
        status,
        navigationError,
        redirectChain,
        viewport,
        blockedWrites,
        blockedSockets,
        networkSafety: {
          initialStorageStateEmpty: true,
          allowedMethods: [...READ_ONLY_METHODS],
          observedReads,
          note: "The harness blocks every non-safe HTTP method and every WebSocket. Allowed GET, HEAD, and OPTIONS requests can still produce ordinary server access logs.",
        },
        hydration: {
          beforeWait: hydrationBeforeWait,
          waitOutcome: hydrationWait,
          afterWait: hydrationAfterWait,
          fontWait,
          consoleErrors: hydrationConsoleErrors,
        },
        consoleMessages,
        pageErrors,
        document: documentSnapshot,
        screenshot: {
          file: `${artifactStem}.png`,
          fullPage: false,
          cssPixelViewport: viewport,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await testInfo.attach("deployed-baseline-observations", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("deployed-baseline-screenshot", {
    path: screenshotPath,
    contentType: "image/png",
  });

  // Reachability and harness dimensions are the only acceptance conditions. The
  // recorded semantic and visual defects above never become success assertions.
  expect(navigationError, "The deployed home page navigation must complete").toBeNull();
  expect(response, "The deployed home page must return a navigation response").not.toBeNull();
  expect(response?.status(), "The deployed home page must remain reachable").toBeGreaterThanOrEqual(
    200,
  );
  expect(response?.status(), "The deployed home page must remain reachable").toBeLessThan(400);
  expect(
    expectedViewport,
    "Every deployed-audit project must declare its exact viewport",
  ).toBeDefined();
  expect(
    page.viewportSize(),
    "The deployed audit must preserve its exact configured viewport",
  ).toEqual(expectedViewport);
});
