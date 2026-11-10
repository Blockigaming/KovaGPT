import { expect, test } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

// Synthetic sessions and focus/visibility events exercise the actual auth SDK
// and React tree. This is not a native-tab or ChatGPT comparison benchmark.
test("five loaded sessions stay editable while return-to-tab auth requests are held", async ({
  browser,
}, info) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ serviceWorkers: "block" })),
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let block = false;
  let pendingHosted = 0;
  let ownedProbes = 0;
  const samples: number[] = [];
  try {
    const pages = await Promise.all(
      contexts.map(async (context, index) => {
        const page = await context.newPage();
        await fixture(page, "dark", true, false, "free");
        await page.route("**/api/auth/session", async (route) => {
          ownedProbes++;
          if (block) await held;
          await route.fulfill({ json: { session: null } });
        });
        await page.route("**/auth/v1/user", async (route) => {
          if (block) {
            pendingHosted++;
            await held;
          }
          await route.fallback();
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await waitForKovaHydration(page);
        const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
        await expect(composer).toBeVisible();
        await composer.fill(`Returning session ${index} unsent draft`);
        return page;
      }),
    );
    block = true;
    for (let round = 0; round < 10; round++) {
      const results = await Promise.all(
        pages.map((page, index) =>
          page.evaluate(
            async ({ index }) => {
              const started = performance.now();
              window.dispatchEvent(new Event("focus"));
              window.dispatchEvent(new Event("visibilitychange"));
              document.dispatchEvent(new Event("visibilitychange"));
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              const composer = document.querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Message KovaGPT"]',
              );
              return {
                elapsedMs: performance.now() - started,
                gate: !!document.querySelector('dialog[aria-label="Checking account"][open]'),
                editable:
                  !!composer &&
                  !composer.disabled &&
                  !composer.closest("[inert]") &&
                  composer.getClientRects().length > 0,
                draftPreserved: composer?.value === `Returning session ${index} unsent draft`,
              };
            },
            { index },
          ),
        ),
      );
      for (const result of results) {
        expect(result.gate, "returning to the tab must not open the authority gate").toBe(false);
        expect(result.editable).toBe(true);
        expect(result.draftPreserved).toBe(true);
        samples.push(result.elapsedMs);
      }
    }
    await expect.poll(() => pendingHosted).toBeGreaterThanOrEqual(5);
    expect(ownedProbes, "Supabase-only builds must not probe self-hosted auth").toBe(0);
    const sorted = samples.slice().sort((a, b) => a - b);
    await info.attach("synthetic-tab-resume-timings", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          method:
            "synthetic focus/visibility events; readiness observed after two animation frames; auth responses held; no ChatGPT baseline",
          sessions: 5,
          samples: samples.length,
          meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          ownedProbes,
        },
        null,
        2,
      ),
    });
  } finally {
    release();
    await Promise.all(contexts.map((context) => context.close()));
  }
});
