import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const auditedProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(!auditedProjects.has(testInfo.project.name));
});

async function expectMainTarget(page: Page) {
  const main = page.locator("#main-content");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveJSProperty("tagName", "MAIN");
  await expect(page.locator('a[href="#main-content"]').first()).toHaveAttribute(
    "href",
    "#main-content",
  );
}

async function expectNoViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}
