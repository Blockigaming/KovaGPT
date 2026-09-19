import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

test("Free chat has no model picker and Thinking is an upgrade action", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "free" });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  await expect(page.locator(".kova-model-static").first()).toContainText("KovaGPT");
  const upgrade = page.getByTestId("thinking-upgrade-button");
  await expect(upgrade).toBeVisible();
  await expect(upgrade).toHaveAttribute("href", "/pricing");
  await upgrade.click();
  await expect(page).toHaveURL(/\/pricing(?:[?#]|$)/);
  expect(chatRequests).toBe(0);
});

test("Plus model selector exposes Lite Medium and Thinking using the High route", async ({
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

  await optionRoot.getByTestId("model-option-high").click();
  await expect(optionRoot).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: KovaGPT Thinking");
  await expect(trigger).toContainText("Thinking");
  await trigger.click();
  await expect(optionRoot.getByTestId("model-option-high")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(optionRoot).toHaveCount(0);
  if (width >= 1200) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  }
});

test("Pro picker keeps all six modes and the High label", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "pro" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const options = page.locator('[data-testid^="model-option-"]:visible');
  await expect(options).toHaveCount(6);
  for (const id of ["instant", "medium", "high", "extra_high", "max", "ultra"]) {
    await expect(page.getByTestId(`model-option-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("model-option-high")).toHaveText("High");
  await page.getByTestId("model-option-high").click();
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: KovaGPT High");
  await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
});

test("signed-out Thinking navigates to upgrade without executing Chat", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("https://*.supabase.co/**", (route) => route.abort("blockedbyclient"));
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  await page.getByTestId("thinking-upgrade-button").click();
  await expect(page).toHaveURL(/\/pricing(?:[?#]|$)/);
  expect(chatRequests).toBe(0);
});
