import { test, expect } from "@playwright/test";

/**
 * Model selector adaptive-rendering test.
 * On touch/phone/tablet layouts the selector opens a bottom sheet; on
 * desktop pointer layouts it opens the popover.
 */
test("model selector opens (bottom sheet on touch, popover on desktop)", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;

  // The selector lives inside the ChatInput. On the empty-state landing it may
  // not be present; if so, we skip.
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  if ((await trigger.count()) === 0) {
    testInfo.skip(true, "Model selector not present on this route/state");
    return;
  }
  await trigger.click();

  if (width < 1200) {
    // Expect the bottom sheet to appear
    const sheet = page.locator('[data-testid="mobile-bottom-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Escape dismisses
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  } else {
    // Desktop popover shows options list — search for at least one option label.
    await expect(page.getByText(/Intelligence/i)).toBeVisible({ timeout: 3000 });
  }
});
