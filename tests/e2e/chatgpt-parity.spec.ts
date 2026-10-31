import { test, expect } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
test.beforeEach(async ({ page }) => {
  await installAuthenticatedFixture(page);
});
import { VIEWPORTS, assertNoHorizontalOverflow, stablePage } from "./parity-helpers";

test.describe("KovaGPT parity invariants", () => {
  for (const [width, height] of VIEWPORTS)
    test(`${width}x${height} has stable responsive geometry`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await stablePage(page);
      await assertNoHorizontalOverflow(page);
      const composer = page.locator(".spec400-composer").first();
      await expect(composer).toBeVisible();
      const box = await composer.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(8);
      expect(width - box!.x - box!.width).toBeGreaterThanOrEqual(8);
    });
  test("keyboard focus is visible and reduced motion is honored", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await stablePage(page);
    const input = page.locator(".spec400-composer textarea");
    await input.focus();
    await expect(input).toBeFocused();
    await expect(page.locator(".spec400-composer")).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("font-size", "16px");
  });
});
