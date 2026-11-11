import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
test.beforeEach(async ({ page }) => {
  await installAuthenticatedFixture(page);
});

import { waitForKovaHydration } from "./hydration";
import { openCurrentSettings } from "./current-ui";

test("connected apps and scheduled tasks fit the configured viewport", async ({ page }) => {
  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");

  await page.goto("/scheduled-tasks", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("Settings remains reachable from the responsive shell", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  const settings = await openCurrentSettings(page);
  await expect(settings.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
});
