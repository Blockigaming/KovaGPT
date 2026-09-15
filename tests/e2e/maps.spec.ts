import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

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
  await installAuthenticatedFixture(page);
  await page.route("**/api/security/lockdown", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false}' }),
  );
  await page.route("**/api/maps/search?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"results":[]}' }),
  );
  await page.goto("/maps");
  const query = page.getByPlaceholder("Ask Kova about Maps");
  const search = page.getByRole("button", { name: "Search maps" });
  await expect(search).toBeEnabled();
  await query.fill("Not a real place 987654321");
  await expect(query).toHaveValue("Not a real place 987654321");
  await search.click();
  await expect(page.getByRole("alert")).toContainText("No matching places were found");
});
