import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

test("Free chat offers Default and Thinking without executing Chat", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "free" });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const thinking = page.getByRole("button", { name: "Thinking", exact: true });
  await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "true");
  await expect(thinking).toHaveCSS("color", "rgb(59, 130, 246)");
  await expect(thinking.locator("svg")).toHaveCSS("color", "rgb(59, 130, 246)");
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  expect(chatRequests).toBe(0);
});

test("Plus model selector exposes Default Medium Thinking and High", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "plus" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const useSheet = await page.evaluate(
    () => window.innerWidth < 1024 || window.matchMedia("(pointer: coarse)").matches,
  );
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const optionRoot = useSheet
    ? page.locator('[data-testid="mobile-bottom-sheet"]')
    : page.getByRole("dialog", { name: "Choose model" });
  await expect(optionRoot).toBeVisible({ timeout: 3000 });
  await expect(optionRoot.getByTestId("model-option-instant")).toBeVisible();
  await expect(optionRoot.getByTestId("model-option-instant")).toHaveText("Default");
  await expect(optionRoot.getByTestId("model-option-medium")).toBeVisible();
  await expect(optionRoot.getByTestId("model-option-high")).toContainText("High");
  await expect(optionRoot.getByTestId("model-option-thinking")).toBeVisible();
  await expect(optionRoot.getByTestId("model-option-extra_high")).toHaveCount(0);

  await optionRoot.getByTestId("model-option-thinking").click();
  await expect(optionRoot).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: KovaGPT Thinking");
  await expect(trigger).toContainText("Thinking");
  await trigger.click();
  await expect(optionRoot.getByTestId("model-option-thinking")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(optionRoot).toHaveCount(0);
  if (!useSheet) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  }
});

test("Pro picker keeps all seven modes and the High label", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "pro" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const trigger = page.locator('[data-testid="model-selector-trigger"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const options = page.locator('[data-testid^="model-option-"]:visible');
  await expect(options).toHaveCount(7);
  for (const id of ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"]) {
    await expect(page.getByTestId(`model-option-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("model-option-high")).toHaveText("High");
  await page.getByTestId("model-option-high").click();
  await expect(trigger).toHaveAttribute("aria-label", "Choose model: KovaGPT High");
  await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
});

test("signed-out visitors must log in before chat or model access", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("https://*.supabase.co/**", (route) => route.abort("blockedbyclient"));
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account", exact: true })).toBeVisible();
});

test.describe("short desktop model picker", () => {
  test.use({ viewport: { width: 1440, height: 520 }, isMobile: false, hasTouch: false });

  test("paid model picker fits a short window and preserves keyboard focus", async ({ page }) => {
    await installAuthenticatedFixture(page, { tier: "pro" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const trigger = page.getByTestId("model-selector-trigger").filter({ visible: true });
    await trigger.click();
    const picker = page.getByRole("dialog", { name: "Choose model", exact: true });
    await expect(picker).toBeVisible();
    expect(
      await picker.evaluate((element) =>
        Boolean(element.closest('[role="dialog"][aria-label="Response options"]')),
      ),
    ).toBe(false);
    const lastOption = picker.getByTestId("model-option-ultra");
    const optionScroll = picker.getByTestId("model-options-scroll");
    // The header stays in place while the options viewport reveals the last
    // model, even when the popover is bounded by a short browser window.
    await optionScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        lastOption.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const hit = button.ownerDocument.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          const scroll = button.closest('[data-testid="model-options-scroll"]');
          return {
            reachable: button.contains(hit),
            scrollTop: scroll?.scrollTop,
            scrollHeight: scroll?.scrollHeight,
            clientHeight: scroll?.clientHeight,
            optionTop: box.top,
            optionBottom: box.bottom,
            hitTarget: hit?.getAttribute("data-testid") ?? hit?.tagName ?? null,
          };
        }),
      )
      .toEqual(expect.objectContaining({ reachable: true }));

    // The Options panel can flip sides after the nested menu opens. Check the
    // settled picker, including the viewport edge, after its scroll correction.
    await expect
      .poll(async () => {
        const bounds = await picker.boundingBox();
        return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(520);
    const bounds = (await picker.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(520);

    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("model-option-instant")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker.getByTestId("model-option-medium")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-label", "Choose model: KovaGPT Medium");
  });
});
