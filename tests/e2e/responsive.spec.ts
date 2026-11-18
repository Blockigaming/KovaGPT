import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { resolveFixtureFunctionName } from "./server-function-fixture";
test.beforeEach(async ({ page }) => {
  await fixture(page, "dark");
});

import { waitForKovaHydration } from "./hydration";
import { composerResourceTrigger, usesSidebarDrawer } from "./current-ui";

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
    page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
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

    // No uncaught console errors (excluding known third-party auth noise).
    const filtered = errors.filter(
      (e) => !/clerk|supabase|analytics|extension|Failed to load resource/i.test(e),
    );
    expect(filtered, `unexpected client errors: ${filtered.join("\n")}`).toEqual([]);
  });

  test("an invalid project list shows a retry instead of throwing on the home screen", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/_serverFn/**", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (!resolveFixtureFunctionName(id)?.startsWith("listProjects_")) return route.fallback();
      return route.fulfill({ json: { result: {}, context: {} } });
    });
    await page.goto("/");
    await waitForKovaHydration(page);
    await (await composerResourceTrigger(page, "Choose project")).click();
    const picker = page.getByRole("dialog", { name: "Choose project", exact: true });
    await expect(picker.getByRole("alert")).toHaveText("Your projects could not be loaded.");
    await expect(picker.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("mobile-only chrome follows the shared desktop breakpoint", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const width = page.viewportSize()?.width ?? 0;
    const isMobileLayout = await usesSidebarDrawer(page);

    if (isMobileLayout) {
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
      await expect(
        page
          .locator("header.kova-topbar:visible")
          .getByRole("heading", { level: 1, name: "KovaGPT", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.locator("header.kova-topbar:not(.kova-desktop-topbar)")).toBeHidden();
    }

    // The desktop sidebar trigger appears only while its persistent sidebar is collapsed.
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
    await testInfo.attach(`chrome-${isMobileLayout ? "mobile" : "desktop"}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
