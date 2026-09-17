import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

test("Free chat has no model picker and Thinking is an upgrade action", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "free" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  await expect(page.locator(".kova-model-static").first()).toContainText("KovaGPT");
  const upgrade = page.getByTestId("thinking-upgrade-button");
  await expect(upgrade).toBeVisible();
  await expect(upgrade).toHaveAttribute("href", "/pricing");
});

test("Plus model selector exposes Instant Medium and Thinking using the High route", async ({
  page,
}) => {
  await installAuthenticatedFixture(page, { tier: "plus" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const optionRoot =
    width < 1200
      ? page.locator('[data-testid="mobile-bottom-sheet"]')
      : page.getByRole("dialog", { name: "Choose model" });
  await expect(optionRoot).toBeVisible({ timeout: 3000 });
  await expect(optionRoot.getByTestId("model-option-instant")).toBeVisible();
  await expect(optionRoot.getByTestId("model-option-medium")).toBeVisible();
  await expect(optionRoot.getByTestId("model-option-high")).toContainText("Thinking");
  await expect(optionRoot.getByTestId("model-option-thinking")).toHaveCount(0);
  await expect(optionRoot.getByTestId("model-option-extra_high")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(optionRoot).toHaveCount(0);
  if (width >= 1200) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  }
});
