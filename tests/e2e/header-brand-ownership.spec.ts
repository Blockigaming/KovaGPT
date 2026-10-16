import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

// Read-only guest layout regression for the existing supported browser harness.
// No launcher, account connection or service mutation is authorized by this test.
for (const colorScheme of ["light", "dark"] as const) {
  test(`desktop sidebar owns standard branding in ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const main = page.locator(".kova-chat-main");
    const brand = page.locator(".kova-desktop-topbar .kova-model-static");
    await expect(main).toHaveAttribute("data-sidebar", "closed");
    await expect(brand).toBeVisible();
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await expect(main).toHaveAttribute("data-sidebar", "open");
    await expect(brand).toBeHidden();
    await expect(page.locator(".kova-sidebar-brand")).toBeVisible();
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(brand).toBeVisible();
  });
  test(`mobile retains standard branding in ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(
      page.locator(".kova-topbar:not(.kova-desktop-topbar) .kova-model-static"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
  });
}
