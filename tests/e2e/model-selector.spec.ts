import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { openResponseOptions } from "./current-ui";

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
  const responseOptions = await openResponseOptions(page);
  await expect(responseOptions).toContainText("Your Free plan uses its included setting.");
  const upgrade = page.getByTestId("thinking-upgrade-button");
  await expect(upgrade).toBeVisible();
  await expect(upgrade).toHaveAttribute("aria-label", "Thinking is locked. Open Subscriptions");
  await upgrade.click();
  await expect(page).toHaveURL(/\/settings\/billing(?:[?#]|$)/);
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
  await openResponseOptions(page);
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
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: Kova GPT Thinking");
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
  await openResponseOptions(page);
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
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: Kova GPT High");
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
  await openResponseOptions(page);
  await page.getByTestId("thinking-upgrade-button").click();
  await expect(page).toHaveURL(/\/pricing(?:[?#]|$)/);
  expect(chatRequests).toBe(0);
});

test.describe("short desktop model picker", () => {
  test.use({ viewport: { width: 1440, height: 520 }, isMobile: false, hasTouch: false });

  test("paid model picker escapes the Options scroller and preserves nested keyboard focus", async ({
    page,
  }) => {
    await installAuthenticatedFixture(page, { tier: "pro" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const responseOptions = await openResponseOptions(page);
    const trigger = page.getByTestId("model-selector-trigger").filter({ visible: true });
    await trigger.click();
    const picker = page.getByRole("dialog", { name: "Choose model", exact: true });
    await expect(picker).toBeVisible();
    expect(
      await picker.evaluate((element) =>
        Boolean(element.closest('[role="dialog"][aria-label="Response options"]')),
      ),
    ).toBe(false);
    const bounds = (await picker.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(520);
    const lastOption = picker.getByTestId("model-option-ultra");
    // On a short viewport the popover itself scrolls. Scrolling only the option
    // can leave it below the popover's clip while Playwright deems it in view.
    await picker.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        lastOption.evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            button.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      )
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(responseOptions).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("model-option-instant")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker.getByTestId("model-option-medium")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(responseOptions).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-label", "Choose model: Kova GPT Medium");
  });
});
