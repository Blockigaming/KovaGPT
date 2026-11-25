import { devices, expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

// The website serves the desktop experience on every device and reflows it to
// the real screen width. Phone-app presentation is reserved for native app
// shells, which mark the document with data-kova-surface="app".
for (const device of ["iPhone 13", "Pixel 7", "iPad Mini landscape"] as const) {
  test(`${device} gets the desktop website sized to its own screen`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    const descriptor = devices[device];
    const context = await browser.newContext({ ...descriptor, baseURL });
    try {
      const page = await context.newPage();
      await installAuthenticatedFixture(page);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        "content",
        "width=device-width, initial-scale=1, viewport-fit=cover",
      );
      await expect(page.locator("html")).toHaveAttribute("data-kova-surface", "web");
      const fit = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(fit.width).toBe(descriptor.viewport.width);
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width);

      const navigation = await revealSidebar(page);
      await navigation.getByRole("button", { name: "New chat", exact: true }).click();
      // Desktop home composition: greeting above a centered composer.
      const greeting = page.locator(".kova-empty-chat .kova-greeting h1");
      const input = page.getByRole("textbox", { name: "Message KovaGPT" });
      await expect(greeting).toBeVisible();
      await expect(input).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Continue working", exact: true }),
      ).toBeHidden();
      const [greetingBox, inputBox] = await Promise.all([
        greeting.boundingBox(),
        input.boundingBox(),
      ]);
      expect(greetingBox!.y).toBeLessThan(inputBox!.y);
      if (descriptor.viewport.width < 768) {
        // Phone web matches the app's phone home: greeting centred, composer docked low.
        expect(inputBox!.y).toBeGreaterThan(descriptor.viewport.height * 0.7);
        expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(descriptor.viewport.height);
      } else {
        expect(inputBox!.y).toBeLessThan(descriptor.viewport.height * 0.7);
      }

      const desktopShell = descriptor.viewport.width >= 1024;
      if (desktopShell) {
        await expect(page.locator(".kova-desktop-topbar")).toBeVisible();
        await expect(page.locator("[data-kova-core-sidebar]")).not.toHaveCSS("position", "fixed");
      } else {
        await page.getByRole("button", { name: "Open menu", exact: true }).click();
        const sidebar = page.locator("[data-kova-core-sidebar]");
        await expect(sidebar.getByRole("link", { name: "Scheduled tasks" })).toBeInViewport();
        await expect(sidebar.getByRole("link", { name: "Connections" })).toBeInViewport();
        await page.keyboard.press("Escape");
      }

      await page.goto("/library", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeInViewport();
    } finally {
      await context.close();
    }
  });
}
