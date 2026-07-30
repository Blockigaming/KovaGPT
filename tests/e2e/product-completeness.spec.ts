import { expect, test } from "@playwright/test";

test.describe("product completeness responsive scaffolding", () => {
  test("help and support surfaces fit the configured viewport", async ({ page }) => {
    await page.goto("/help", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/KovaGPT Help Center/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /How can we help/i })).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });

  test("command palette, notifications, and policies have smoke targets", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /notifications/i })).toBeVisible();
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^Privacy Policy$/i })).toBeVisible();
  });
});
