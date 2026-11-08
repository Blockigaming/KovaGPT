import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["light", "dark"] as const) {
  test(`workspace page cascade preserves widths and responsive gutters in ${theme}`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    const width = page.viewportSize()!.width;
    // Projects fills the available workspace. The other directories retain their
    // readable width limits; each surface owns its responsive gutters.
    for (const route of [
      {
        path: "/projects",
        selector: ".kova-project-directory",
        maximum: null,
        gutter: width < 768 ? 16 : Math.min(32, Math.max(16, width * 0.03)),
        top: width < 768 ? 20 : 32,
      },
      {
        path: "/library",
        selector: ".kova-library-page",
        maximum: 1200,
        gutter: width <= 640 ? 16 : width < 1024 ? 24 : 32,
        top: width <= 640 ? 20 : width < 1024 ? 24 : 32,
      },
      {
        path: "/apps",
        selector: ".spec400-plugins",
        maximum: 1200,
        gutter: width < 768 ? 16 : width < 1024 ? 24 : 32,
        top: width < 768 ? 16 : width < 1024 ? 24 : 32,
      },
      {
        path: "/scheduled-tasks",
        selector: ".spec400-schedules",
        maximum: 1200,
        gutter: width < 768 ? 16 : width < 1024 ? 24 : 32,
        top: width < 768 ? 16 : width < 1024 ? 24 : 32,
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
          maximum: style.maxWidth,
          available:
            element.parentElement!.clientWidth -
            parseFloat(getComputedStyle(element.parentElement!).paddingLeft) -
            parseFloat(getComputedStyle(element.parentElement!).paddingRight),
          left: parseFloat(style.paddingLeft),
          right: parseFloat(style.paddingRight),
          top: parseFloat(style.paddingTop),
          width: box.width,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (route.maximum === null) {
        expect(geometry.maximum, route.path).toBe("none");
        expect(geometry.width, route.path).toBeCloseTo(geometry.available, 0);
      } else {
        expect(parseFloat(geometry.maximum), route.path).toBe(route.maximum);
        expect(geometry.width, route.path).toBeLessThanOrEqual(route.maximum);
      }
      expect(geometry.left, route.path).toBeCloseTo(route.gutter, 1);
      expect(geometry.right, route.path).toBeCloseTo(route.gutter, 1);
      expect(geometry.top, route.path).toBe(route.top);
      expect(geometry.overflow, route.path).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath(`${route.path.slice(1)}-layout-${theme}.png`),
        animations: "disabled",
      });
    }
  });
}
