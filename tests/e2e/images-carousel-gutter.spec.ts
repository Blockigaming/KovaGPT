import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

// Supported read-only guest browser harness only; no image generation or service writes.
for (const width of [390, 639, 640, 767, 834, 1023, 1024, 1440]) {
  test(`Images content stays contained while style carousel scrolls at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1112 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/images", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const content = page.locator(".kova-app-content");
    const carousel = page.locator(".kova-image-style-scroll");
    await expect(carousel).toBeVisible();
    const dimensions = await content.evaluate((root) => ({
      client: root.clientWidth,
      scroll: root.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const initial = await carousel.evaluate((root) => ({
      client: root.clientWidth,
      scroll: root.scrollWidth,
      left: root.scrollLeft,
    }));
    expect(initial.scroll).toBeGreaterThan(initial.client);
    await page.getByRole("button", { name: "Scroll styles right", exact: true }).click();
    await expect
      .poll(() => carousel.evaluate((root) => root.scrollLeft))
      .toBeGreaterThan(initial.left);
    expect(await content.evaluate((root) => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Scroll styles left", exact: true }).click();
    await expect.poll(() => carousel.evaluate((root) => root.scrollLeft)).toBe(initial.left);
  });
}
