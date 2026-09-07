import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const auditedProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name));
});

test("nested project URLs keep their leaf content after hydration", async ({ page }) => {
  for (const path of [
    "/projects/unavailable-project",
    "/projects/unavailable-project/chat/unavailable-chat",
  ]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBeLessThan(500);
    await waitForKovaHydration(page);

    await expect(page, path).toHaveURL(path);
    await expect(
      page.getByRole("heading", { name: "Sign in required", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toHaveCount(0);
  }
});

test("nested assistant URLs keep their leaf not-found state after hydration", async ({ page }) => {
  const path = "/assistants/unpublished-assistant";
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await waitForKovaHydration(page);

  await expect(page).toHaveURL(path);
  await expect(
    page.getByRole("heading", { name: "We couldn't find that page", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "KovaGPT Assistants", exact: true })).toHaveCount(
    0,
  );
});
