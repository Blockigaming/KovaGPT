import { expect, test } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

type ReturnObservation = {
  trusted: boolean;
  elapsedMs: number;
  editable: boolean;
  draftPreserved: boolean;
  gate: boolean;
};
declare global {
  interface Window {
    kovaNativeReturnProbe: {
      armed: boolean;
      observations: ReturnObservation[];
    };
  }
}

// Product acceptance budgets, not measured or published ChatGPT performance.
const averageBudgetMs = 100;
const p95BudgetMs = 200;

test("native tab activation keeps five loaded sessions editable within the return budget", async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const contexts = [];
  const sessions = [];
  let held = false;
  let pendingHosted = 0;
  let ownedProbes = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  try {
    for (let index = 0; index < 5; index++) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
      const page = await context.newPage();
      await fixture(page, "dark", true, false, "free");
      await page.route("**/api/auth/session", async (route) => {
        ownedProbes++;
        if (held) await pending;
        await route.fulfill({ json: { session: null } });
      });
      await page.route("**/auth/v1/user", async (route) => {
        if (held) {
          pendingHosted++;
          await pending;
        }
        await route.fallback();
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
      await expect(composer).toBeVisible();
      const draft = `Native return ${index} unsent draft`;
      await composer.fill(draft);
      await page.evaluate((draft) => {
        const probe = { armed: false, observations: [] as ReturnObservation[] };
        window.kovaNativeReturnProbe = probe;
        document.addEventListener("visibilitychange", (event) => {
          if (!probe.armed || document.visibilityState !== "visible") return;
          probe.armed = false;
          const started = performance.now();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const composer = document.querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Message KovaGPT"]',
              );
              probe.observations.push({
                trusted: event.isTrusted,
                elapsedMs: performance.now() - started,
                editable:
                  !!composer &&
                  !composer.disabled &&
                  !composer.readOnly &&
                  !composer.closest("[inert]") &&
                  composer.getClientRects().length > 0,
                draftPreserved: composer?.value === draft,
                gate: !!document.querySelector('dialog[aria-label="Checking account"][open]'),
              });
            });
          });
        });
      }, draft);
      const away = await context.newPage();
      // Playwright otherwise forces every page to remain focused/visible.
      // Disable only its test emulation so real activation events can occur.
      for (const tab of [page, away]) {
        const cdp = await context.newCDPSession(tab);
        await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      }
      sessions.push({ page, away, composer, draft });
    }
    held = true;
    for (let round = 0; round < 10; round++) {
      for (const { page, away } of sessions) {
        await away.bringToFront();
        await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
        await page.evaluate(() => (window.kovaNativeReturnProbe.armed = true));
        await page.bringToFront();
        await expect
          .poll(() => page.evaluate(() => window.kovaNativeReturnProbe.observations.length))
          .toBe(round + 1);
        const result = await page.evaluate(() => window.kovaNativeReturnProbe.observations.at(-1)!);
        expect(
          result.trusted,
          "must observe a browser-generated activation, not dispatchEvent",
        ).toBe(true);
        expect(result.gate).toBe(false);
        expect(result.editable).toBe(true);
        expect(result.draftPreserved).toBe(true);
      }
    }
    await expect.poll(() => pendingHosted).toBeGreaterThanOrEqual(5);
    expect(ownedProbes).toBe(0);
    const observations = (
      await Promise.all(
        sessions.map(({ page }) => page.evaluate(() => window.kovaNativeReturnProbe.observations)),
      )
    ).flat();
    expect(observations).toHaveLength(50);
    const timings = observations.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
    const meanMs = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1];
    // Exercise real input after the timing observations without sending a chat.
    for (const { page, composer, draft } of sessions) {
      await page.bringToFront();
      await composer.press("End");
      await composer.press("x");
      await expect(composer).toHaveValue(`${draft}x`);
    }
    await info.attach("native-tab-return-timings", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          method:
            "Chromium bringToFront with forced-focus emulation disabled; trusted visible event to editable observation after two animation frames; synthetic hosted accounts; auth responses held",
          headless: info.project.use.headless ?? true,
          sessions: 5,
          samples: observations.length,
          meanMs,
          p95Ms,
          budgets: { averageBudgetMs, p95BudgetMs },
          ownedProbes,
          observations,
          limitations:
            "Local/CI loaded-tab activation only. Not a production five-user load test, initial page load, API response latency or ChatGPT comparison. Browser-suspended/discarded tabs are excluded.",
        },
        null,
        2,
      ),
    });
    expect(meanMs, "mean loaded-tab readiness observation").toBeLessThan(averageBudgetMs);
    expect(p95Ms, "p95 loaded-tab readiness observation").toBeLessThan(p95BudgetMs);
  } finally {
    release();
    await Promise.all(contexts.map((context) => context.close()));
  }
});
