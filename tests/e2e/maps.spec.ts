import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

test("Maps stays unavailable and undiscoverable without approval", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Maps" })).toHaveCount(0);
  await page.goto("/maps");
  await expect(page.getByRole("heading", { name: "Maps unavailable" })).toBeVisible();
  await expect(page.getByText("Maps is not enabled for this release.")).toBeVisible();
  await expect(page.getByTestId("map-container")).toHaveCount(0);
});

test("Maps unavailable page does not contact map services", async ({ page }) => {
  const mapRequests: string[] = [];
  page.on("request", (request) => {
    if (/maps\/search|openfreemap|nominatim/i.test(request.url())) mapRequests.push(request.url());
  });
  await installAuthenticatedFixture(page);
  await page.goto("/maps");
  await expect(page.getByRole("heading", { name: "Maps unavailable" })).toBeVisible();
  expect(mapRequests).toEqual([]);
});
