import { expect, test } from "@playwright/test";

test("Maps navigation opens the responsive Maps workspace", async ({ page }) => {
  await page.goto("/");
  const maps = page.getByRole("link", { name: "Maps" }).first();
  await expect(maps).toBeVisible();
  await maps.click();
  await expect(page).toHaveURL(/\/maps$/);
  await expect(page.getByPlaceholder("Ask Kova about Maps")).toBeVisible();
  await expect(page.getByTestId("map-container")).toBeVisible();
  await expect(page.locator("main#main-content")).toHaveCSS("overflow", "hidden");
});

test("Maps shows a useful message for a failed place search", async ({ page }) => {
  await page.route("**/api/maps/search?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"results":[]}' }),
  );
  await page.goto("/maps");
  await page.getByPlaceholder("Ask Kova about Maps").fill("Not a real place 987654321");
  await page.getByRole("button", { name: "Search maps" }).click();
  await expect(page.getByRole("alert")).toContainText("No matching places were found");
});
