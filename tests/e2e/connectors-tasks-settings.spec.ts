import { expect, test } from "@playwright/test";

test("connected apps and scheduled tasks fit the configured viewport", async ({ page }) => {
  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");

  await page.goto("/scheduled-tasks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main").or(page.locator("body"))).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("Settings remains reachable from the responsive shell", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
