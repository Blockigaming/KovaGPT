import { usesCompactSettings } from "./settings-layout-fixture";
import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("logged-out homepage loads its restored image with a device-specific crop", async ({
  page,
}) => {
  await fixture(page, "light", false);
  await page.goto("/");
  await waitForKovaHydration(page);
  const image = page.locator(".public-classroom img");
  await expect(image).toBeVisible();
  await image.evaluate((node) => (node as HTMLImageElement).decode());
  const rendered = await image.evaluate((node) => {
    const img = node as HTMLImageElement;
    return {
      source: img.currentSrc,
      width: img.naturalWidth,
      aspect: getComputedStyle(img).aspectRatio,
    };
  });
  expect(rendered.source).toMatch(/classroom-hero-restored(?:-768)?\.webp$/);
  expect(rendered.width).toBeGreaterThan(0);
  const compact = await usesCompactSettings(page);
  expect(rendered.aspect).toBe(
    compact ? "2.1 / 1" : page.viewportSize()!.width <= 1023 ? "4 / 3" : "4 / 5",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
