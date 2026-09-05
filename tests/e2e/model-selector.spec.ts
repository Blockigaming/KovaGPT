import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

/**
 * Model selector adaptive-rendering test.
 * On touch/phone/tablet layouts the selector opens a bottom sheet; on
 * desktop pointer layouts it opens the popover.
 */
test("model selector opens (bottom sheet on touch, popover on desktop)", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  await expect(
    trigger,
    "the authenticated primary chat composer must expose its truthful model selector",
  ).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  if (width < 1200) {
    const sheet = page.locator('[data-testid="mobile-bottom-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  } else {
    const dialog = page.getByRole("dialog", { name: "Choose model" });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.locator('[data-testid^="model-option-"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  }
});
