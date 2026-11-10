import { expect, test, type Page } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { revealSidebar } from "../e2e/current-ui";

type LoadingObservation = {
  readyMs: number;
  lcpMs: number | null;
  cls: number | null;
  longTasks: number | null;
  longTaskMs: number | null;
};
declare global {
  interface Window {
    kovaLoadingProbe: LoadingObservation;
  }
}

async function observeLoading(page: Page, signedIn = true) {
  await page.addInitScript((signedIn) => {
    const probe: LoadingObservation = {
      readyMs: 0,
      lcpMs: null,
      cls: PerformanceObserver.supportedEntryTypes.includes("layout-shift") ? 0 : null,
      longTasks: PerformanceObserver.supportedEntryTypes.includes("longtask") ? 0 : null,
      longTaskMs: PerformanceObserver.supportedEntryTypes.includes("longtask") ? 0 : null,
    };
    window.kovaLoadingProbe = probe;
    for (const type of ["largest-contentful-paint", "layout-shift", "longtask"]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint") probe.lcpMs = entry.startTime;
          if (type === "layout-shift") {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput && probe.cls !== null) probe.cls += shift.value;
          }
          if (type === "longtask") {
            if (probe.longTasks !== null) probe.longTasks++;
            if (probe.longTaskMs !== null) probe.longTaskMs += entry.duration;
          }
        }
      }).observe({ type, buffered: true });
    }
    const sample = () => {
      const composer = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
        signedIn ? 'textarea[aria-label="Message KovaGPT"]' : 'input[type="email"]',
      );
      if (
        document.documentElement.dataset.kovaHydration === "ready" &&
        composer &&
        !composer.disabled &&
        !composer.readOnly &&
        !composer.closest("[inert]") &&
        composer.getClientRects().length > 0 &&
        !document.querySelector('dialog[aria-label="Checking account"][open]')
      ) {
        probe.readyMs = performance.now();
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, signedIn);
}

async function ready(page: Page, signedIn = true) {
  await expect
    .poll(() => page.evaluate(() => window.kovaLoadingProbe?.readyMs ?? 0), { timeout: 15000 })
    .toBeGreaterThan(0);
  const composer = signedIn
    ? page.getByRole("textbox", { name: "Message KovaGPT", exact: true })
    : page.locator('input[type="email"]');
  await expect(composer).toBeEditable();
  const value = signedIn ? "Synthetic loading verification draft" : "loading@example.invalid";
  await composer.fill(value);
  await expect(composer).toHaveValue(value);
  return page.evaluate(() => window.kovaLoadingProbe);
}

function summary(samples: LoadingObservation[]) {
  const times = samples.map((s) => s.readyMs).sort((a, b) => a - b);
  return {
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    samples,
  };
}

for (const signedIn of [false, true]) {
  test(`${signedIn ? "signed-in" : "guest"} first visits and reloads stay within the five-session loading budget`, async ({
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all(
      Array.from({ length: 5 }, () =>
        browser.newContext({
          serviceWorkers: "block",
          viewport: info.project.use.viewport,
          isMobile: info.project.use.isMobile,
          hasTouch: info.project.use.hasTouch,
        }),
      ),
    );
    const errors: string[] = [];
    try {
      const pages = await Promise.all(
        contexts.map(async (context) => {
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await fixture(page, "dark", signedIn, false, "free", { preserveStorageOnReload: true });
          await observeLoading(page, signedIn);
          return page;
        }),
      );
      const first = await Promise.all(
        pages.map(async (page) => {
          await page.goto("/", { waitUntil: "domcontentloaded" });
          return ready(page, signedIn);
        }),
      );
      const reload = await Promise.all(
        pages.map(async (page) => {
          await page.reload({ waitUntil: "domcontentloaded" });
          return ready(page, signedIn);
        }),
      );
      await info.attach("five-session-loading", {
        contentType: "application/json",
        body: JSON.stringify(
          {
            method:
              "fresh browser profiles, then same-profile reloads; navigation start to hydrated editable composer, sampled by animation frame",
            viewport: info.project.use.viewport,
            signedIn,
            first: summary(first),
            reload: summary(reload),
            limits: { meanMs: 2500, p95Ms: 4000, cls: 0.1 },
            limitations:
              "Local/CI synthetic account services; request routing disables HTTP cache, so reload does not establish warm-cache performance. No production capacity, geographic network or ChatGPT comparison is inferred. LCP/CLS/long tasks are diagnostics at readiness, not field Core Web Vitals.",
          },
          null,
          2,
        ),
      });
      expect(errors).toEqual([]);
      for (const samples of [first, reload]) {
        expect(summary(samples).meanMs).toBeLessThan(2500);
        expect(summary(samples).p95Ms).toBeLessThan(4000);
        for (const sample of samples) {
          if (sample.cls !== null) expect(sample.cls).toBeLessThanOrEqual(0.1);
        }
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}

test("slower CPU and delayed assets still produce an editable chat", async ({
  page,
  context,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "CDP CPU throttling is Chromium-only; ordinary loading runs in every engine.",
  );
  await fixture(page, "dark", true, false, "free");
  await observeLoading(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.route("**/*", async (route) => {
    if (["script", "stylesheet", "font"].includes(route.request().resourceType())) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await route.fallback();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sample = await ready(page);
    await info.attach("slower-device-loading", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          cpuRate: 4,
          assetDelayMs: 150,
          sample,
          budgetMs: 7500,
          limitations:
            "Fixed per-request delay, not bandwidth/packet-loss emulation or a physical phone benchmark.",
        },
        null,
        2,
      ),
    });
    expect(sample.readyMs).toBeLessThan(7500);
    if (sample.cls !== null) expect(sample.cls).toBeLessThanOrEqual(0.1);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

test("loaded chat keeps its draft through network loss and recovery", async ({
  page,
  context,
  browserName,
}, info) => {
  await fixture(page, "dark", true, false, "free");
  await observeLoading(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  let blocked = false;
  let attempts = 0;
  await page.route("**/auth/v1/user", async (route) => {
    if (blocked) {
      attempts++;
      return route.abort("internetdisconnected");
    }
    await route.fallback();
  });
  blocked = true;
  await context.setOffline(true);
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => attempts).toBeGreaterThan(0);
    await expect(composer).toBeEditable();
    await composer.press("End");
    await composer.press("x");
    await expect(composer).toHaveValue("Synthetic loading verification draftx");
  } finally {
    blocked = false;
    await context.setOffline(false);
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
  }
  await expect(composer).toBeEditable();
  await expect(composer).toHaveValue("Synthetic loading verification draftx");
  await info.attach("recovery-scope", {
    contentType: "application/json",
    body: JSON.stringify({
      offlineAuthAttempts: attempts,
      lifecycleFreezeExercised: browserName === "chromium",
      draftPreserved: true,
      limitations:
        "Existing loaded tab and CDP lifecycle freeze/active only; synthetic focus triggers validation. OS/browser discards, sleep duration, expired credentials and real backend recovery are separate acceptance cases.",
    }),
  });
});

test("client navigation to Library, Projects and back stays responsive", async ({ page }, info) => {
  await fixture(page, "dark", true, false, "free");
  await observeLoading(page);
  // Desktop navigation remains available; on mobile use real menu controls.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  const samples = [];
  for (const name of ["Library", "Projects"]) {
    await revealSidebar(page);
    const started = await page.evaluate(() => performance.now());
    await page.getByRole("link", { name, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}(?:[?#]|$)`));
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    samples.push({ name, elapsedMs: (await page.evaluate(() => performance.now())) - started });
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
    ).toBeEditable();
  }
  await info.attach("client-navigation-timings", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        samples,
        budgetMs: 2000,
        limitations:
          "Click-to-visible route observation includes test-driver overhead; mocked account data, not real database latency. Browser history return is checked for editability.",
      },
      null,
      2,
    ),
  });
  for (const sample of samples) expect(sample.elapsedMs).toBeLessThan(2000);
});
