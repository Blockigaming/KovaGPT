import { test, expect } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";
import { fixture } from "./actual-app-fixture";

test.beforeEach(async ({ page }) => {
  await fixture(page, "dark", true);
});

test.describe("core shell and chat experience", () => {
  test("empty chat, sidebar drawer, multiline composer, and theme states render", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "dark"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator("#chat-greeting")).toBeVisible();
    await expect(page.locator("#chat-greeting")).not.toHaveText("");

    const textbox = page.getByRole("textbox").first();
    await textbox.fill("Line one");
    await textbox.press("Shift+Enter");
    await textbox.type("Line two");
    await expect(textbox).toHaveValue(/Line one\nLine two/);

    const menu = page.getByRole("button", { name: /open menu/i }).first();
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      await expect(page.getByRole("dialog", { name: /primary navigation/i })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: /primary navigation/i })).toHaveCount(0);
    }
  });

  test("active chat error and retry surfaces remain reachable", async ({ page }, testInfo) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Provider unavailable",
          category: "model_provider_failure",
          retryable: true,
          requestId: "req_test",
        }),
      });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const textbox = page.getByRole("textbox").first();
    await textbox.fill("Hello from the retry test");
    await expect(page.getByTestId("send-button")).toBeEnabled();
    if (testInfo.project.use.hasTouch) {
      await page.getByTestId("send-button").click();
    } else {
      const shortcuts = (await textbox.getAttribute("aria-keyshortcuts")) ?? "";
      await textbox.press(shortcuts.startsWith("Enter ") ? "Enter" : "Control+Enter");
    }
    await expect(
      page.getByText(/Provider unavailable|AI provider had a hiccup|Tap retry/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /retry/i }).first()).toBeVisible();
  });
});
