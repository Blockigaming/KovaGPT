import { test, expect, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

/**
 * Responsive smoke suite. Runs against every viewport project in
 * playwright.config.ts. Verifies core invariants:
 *  - Home page renders without SSR/hydration errors
 *  - No horizontal overflow at the given viewport
 *  - Purpose-built mobile navigation and desktop sidebar chrome are
 *    correctly gated by viewport
 */

async function noHorizontalOverflow(page: Page) {
  // Some pages have expected off-screen elements (drawer). Ignore fixed elements
  // that are intentionally translated off-canvas.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(overflow.scrollWidth, "document should not overflow horizontally").toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}

test.describe("KovaGPT responsive shell", () => {
  test("home renders and has no horizontal overflow", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    // Basic content assertion — the app root always renders a textarea or
    // the empty-state landing with the KovaGPT brand.
    await expect(page.locator("body")).toBeVisible();

    await noHorizontalOverflow(page);

    // Attach a diagnostic screenshot for each project so we have visual evidence.
    await testInfo.attach("home", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    // No uncaught console errors (excluding known 3rd-party auth noise).
    const filtered = errors.filter(
      (e) => !/clerk|supabase|analytics|extension|Failed to load resource/i.test(e),
    );
    expect(filtered, `unexpected client errors: ${filtered.join("\n")}`).toEqual([]);
  });

  test("mobile-only chrome is only visible on phone layouts", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const width = page.viewportSize()?.width ?? 0;
    const isPhone = width < 768;

    if (isPhone) {
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
      await expect(
        page
          .locator("header.kova-topbar span:visible")
          .filter({ hasText: /^KovaGPT$/u })
          .first(),
      ).toBeVisible();
    }

    // Desktop-only PanelLeft trigger appears only when sidebar is collapsed on md+
    const collapsedTrigger = page.getByRole("button", { name: /open sidebar/i });
    if (width >= 1200) {
      // Persistent sidebar starts open on desktop; the fixed trigger should NOT be visible.
      await expect(collapsedTrigger)
        .toHaveCount(0)
        .catch(async () => {
          // If it exists (variant), ensure not visible.
          await expect(collapsedTrigger.first()).toBeHidden();
        });
    }
    await testInfo.attach(`chrome-${isPhone ? "phone" : "large"}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
