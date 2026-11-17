import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";
import { installAuthenticatedFixture } from "./authenticated-fixture";

const auditedProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name));
});

test("nested project URLs keep their leaf content after hydration", async ({ page }) => {
  await installAuthenticatedFixture(page);
  for (const [path, heading] of [
    ["/projects/unavailable-project", "Project could not be opened"],
    ["/projects/unavailable-project/chat/unavailable-chat", "Project chat unavailable"],
  ]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBeLessThan(500);
    await waitForKovaHydration(page);

    await expect(page, path).toHaveURL(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.locator("#projects-title")).toHaveCount(0);
  }
});

test("unpublished assistant URLs return to home after a 404", async ({ page }) => {
  await installAuthenticatedFixture(page);
  const path = "/assistants/unpublished-assistant";
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await waitForKovaHydration(page);

  await expect(page).toHaveURL("/");
  await expect(page.getByText("Sorry, this page doesn’t exist!", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "KovaGPT Assistants", exact: true }),
  ).toHaveCount(0);
});
