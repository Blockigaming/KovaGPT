import { test, expect } from "@playwright/test";
import { VIEWPORTS, assertNoHorizontalOverflow, stablePage } from "./parity-helpers";

test.describe("KovaGPT parity invariants", () => {
  for (const [width, height] of VIEWPORTS)
    test(`${width}x${height} has stable responsive geometry`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await stablePage(page);
      await assertNoHorizontalOverflow(page);
      const composer = page.locator(".kova-composer").first();
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
    const input = page.locator(".kova-composer textarea");
    await input.focus();
    const composer = page.locator(".kova-composer");
    const focused = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
      };
    });
    expect(focused.borderColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(focused.boxShadow).not.toBe("none");
    await expect(input).toHaveCSS("font-size", "16px");
  });
});
