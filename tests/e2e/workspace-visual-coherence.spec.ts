import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const auditedProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(!auditedProjects.has(testInfo.project.name));
});

async function expectOneMainWithoutOverflow(page: Page) {
  const main = page.locator("main#main-content");
  await expect(main).toHaveCount(1);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("signed-out workspace discovery keeps focused hierarchy and truthful controls", async ({
  page,
}) => {
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expectOneMainWithoutOverflow(page);
  await expect(page.getByRole("heading", { name: "Sign in to use Projects" })).toBeVisible();

  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expectOneMainWithoutOverflow(page);
  await expect(page.getByRole("heading", { name: "Saved in this browser" })).toBeVisible();
  await expect(page.getByPlaceholder("Search Library")).toHaveCount(0);

  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expectOneMainWithoutOverflow(page);
  await expect(page.getByRole("heading", { name: "Apps & plugins", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to connect services" })).toBeVisible();
  await expect(page.getByPlaceholder("Search apps and plugins")).toHaveCount(0);

  await page.goto("/images", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expectOneMainWithoutOverflow(page);
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Image history", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use Portrait mode style", exact: true }),
  ).toHaveCount(1);
});
