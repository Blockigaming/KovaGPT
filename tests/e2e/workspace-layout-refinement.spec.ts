import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["light", "dark"] as const) {
  test(`workspace page owners control widths and responsive gutters in ${theme}`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    const width = page.viewportSize()!.width;
    for (const route of [
      {
        path: "/projects",
        selector: ".kova-project-directory",
        maximum: 1280,
        gutter: Math.min(40, Math.max(16, width * 0.03)),
        top: 24,
      },
      {
        path: "/library",
        selector: ".kova-library-page",
        maximum: 1200,
        gutter: width < 768 ? 16 : width < 1024 ? 24 : 32,
        top: width < 768 ? 16 : width < 1024 ? 24 : 32,
      },
      {
        path: "/apps",
        selector: ".spec400-plugins",
        maximum: 1040,
        gutter: Math.min(40, Math.max(20, width * 0.04)),
        top: 24,
      },
      {
        path: "/scheduled-tasks",
        selector: ".spec400-schedules",
        maximum: 1040,
        gutter: Math.min(40, Math.max(20, width * 0.04)),
        top: 24,
      },
    ]) {
      await page.goto(route.path);
      await waitForKovaHydration(page);
      const surface = page.locator(route.selector);
      await expect(surface).toBeVisible();
      const geometry = await surface.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          maximum: parseFloat(style.maxWidth),
          left: parseFloat(style.paddingLeft),
          right: parseFloat(style.paddingRight),
          top: parseFloat(style.paddingTop),
          width: box.width,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(geometry.maximum, route.path).toBe(route.maximum);
      expect(geometry.width, route.path).toBeLessThanOrEqual(route.maximum);
      const gutter = width < 640 && route.path !== "/library" ? 16 : route.gutter;
      const top = width < 640 && route.path !== "/library" ? 20 : route.top;
      expect(geometry.left, route.path).toBeCloseTo(gutter, 1);
      expect(geometry.right, route.path).toBeCloseTo(gutter, 1);
      expect(geometry.top, route.path).toBe(top);
      expect(geometry.overflow, route.path).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath(`${route.path.slice(1)}-layout-${theme}.png`),
        animations: "disabled",
      });
    }
  });
}
