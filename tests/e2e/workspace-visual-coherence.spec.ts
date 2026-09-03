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
  await expect(main).not.toHaveAttribute("aria-busy", "true");
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
  await expect(
    page.getByRole("heading", { name: "Saved in this browser", exact: true }),
  ).toBeVisible();
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

test("Library preview traps focus, closes with Escape, and restores its trigger", async ({
  page,
}) => {
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      "kova-guest-library",
      JSON.stringify([
        {
          id: "guest-focus-contract",
          title: "Focus restoration sample",
          item_type: "document",
          source: "manual",
          content_text: "Preview content for the modal focus contract.",
          file_url: null,
          file_name: "focus-sample.txt",
          file_type: "text/plain",
          file_size: 45,
          created_at: "2026-09-02T00:00:00.000Z",
        },
      ]),
    );
  });
  await page.getByRole("button", { name: "Refresh" }).click();

  const trigger = page.getByRole("button", { name: "Actions for Focus restoration sample" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const previewMenuItem = page.getByRole("menuitem", { name: "Preview", exact: true });
  await expect(previewMenuItem).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Focus restoration sample" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);

  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
