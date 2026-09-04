import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

test.describe("product completeness responsive scaffolding", () => {
  test("help and support surfaces fit the configured viewport", async ({ page }) => {
    await page.goto("/help", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.getByText(/KovaGPT Help Center/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /How can we help/i })).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });

  test("command palette, notifications, and policies have smoke targets", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(composer).toBeVisible();
    await composer.click();
    await page.waitForTimeout(250);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(
      page.getByRole("dialog", {
        name: "Search workspace, chats, and actions",
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: /notifications/i })).toBeVisible();
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: /^Privacy Policy$/i })).toBeVisible();
  });
});
