import { expect, test } from "@playwright/test";

const viewports = [
  [320, 700],
  [375, 812],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1728, 1117],
] as const;

test.describe("product completeness responsive scaffolding", () => {
  for (const [width, height] of viewports) {
    test(`help and support surfaces fit ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/help");
      await expect(page.getByText(/KovaGPT Help Center/i).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: /How can we help/i })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(
        /voice|microphone|dictation|read aloud/i,
      );
    });
  }

  test("command palette, notifications, policies, and offline states have smoke targets", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: /notifications/i })).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: /^Privacy Policy$/i })).toBeVisible();
  });
});
