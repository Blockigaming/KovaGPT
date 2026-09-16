import { expect, test } from "@playwright/test";

test("Maps stays hidden and fails closed while release approval is pending", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Maps" })).toHaveCount(0);
  await page.goto("/maps");
  await expect(page.getByRole("alert")).toContainText("Maps is unavailable");
  await expect(page.getByPlaceholder("Ask Kova about Maps")).toHaveCount(0);
});
