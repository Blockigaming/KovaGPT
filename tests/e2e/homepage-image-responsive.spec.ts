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
      compact: matchMedia(
        "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)",
      ).matches,
    };
  });
  expect(rendered.source).toMatch(/classroom-hero-restored(?:-768)?\.webp$/);
  expect(rendered.width).toBeGreaterThan(0);
  const expectedAspect = rendered.compact
    ? 2.1
    : page.viewportSize()!.width <= 1023
      ? 4 / 3
      : 4 / 5;
  const [width, height] = rendered.aspect.split("/").map(Number);
  expect(width / (height ?? 1)).toBeCloseTo(expectedAspect);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
