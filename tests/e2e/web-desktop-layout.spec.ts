import { devices, expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { openCurrentSettings, revealSidebar } from "./current-ui";

for (const device of ["iPhone 13", "Pixel 7", "iPad Mini landscape"] as const) {
  test(`${device} opens the desktop website on a touch screen`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    const context = await browser.newContext({ ...devices[device], baseURL });
    try {
      const page = await context.newPage();
      await fixture(page, "dark", true, true);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        "content",
        "width=1280, viewport-fit=cover",
      );
      expect(
        await page.evaluate(() => matchMedia("(width >= 1280px) and (pointer: coarse)").matches),
      ).toBe(true);
      await expect(page.locator(".kova-desktop-topbar")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeHidden();
      await expect(page.locator("[data-kova-core-sidebar]")).not.toHaveCSS("position", "fixed");
      await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
      await expect(page.locator("[data-chat-transcript]")).toBeVisible();
      const sidebar = await revealSidebar(page);
      await sidebar.getByRole("button", { name: "New chat", exact: true }).click();
      const recent = page.locator(".kova-desktop-recent-work");
      await expect(recent).toBeAttached();
      await expect(recent).toBeHidden();

      const settings = await openCurrentSettings(page);
      await expect(settings.locator(".kova-settings-sidebar")).toBeVisible();
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      await expect(settings).toBeHidden();

      await page.goto("/apps", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeHidden();
    } finally {
      await context.close();
    }
  });
}
