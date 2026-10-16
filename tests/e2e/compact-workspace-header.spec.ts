import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

// Supported browser harness only. Guest read-only layout checks; no timer start.
for (const width of [390, 834, 1440]) {
  for (const path of ["/library", "/files", "/projects", "/apps"]) {
    test(`header utilities wrap within ${path} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1112 });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      const header = page.locator(".kova-page-header").first();
      const timers = header.getByRole("button", { name: /Timers/ });
      await expect(timers).toBeVisible();
      await expect(page.locator(".kova-core-utilities")).toHaveCount(1);
      const geometry = await header.evaluate((root) => {
        const title = root.querySelector("h1")!.getBoundingClientRect();
        const actions = root.querySelector(".kova-page-actions")!.getBoundingClientRect();
        return {
          inside: actions.left >= 0 && actions.right <= innerWidth,
          overlap:
            Math.min(title.right, actions.right) > Math.max(title.left, actions.left) &&
            Math.min(title.bottom, actions.bottom) > Math.max(title.top, actions.top),
          margin: getComputedStyle(root).marginBottom,
        };
      });
      expect(geometry.inside).toBe(true);
      expect(geometry.overlap).toBe(false);
      expect(geometry.margin).toBe("0px");
      await timers.click();
      const panel = page.getByRole("region", { name: "Timer controls" });
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(timers).toBeFocused();
    });
  }
}
