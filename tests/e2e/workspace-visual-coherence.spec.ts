import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";
import { coreFixture } from "./core-app-fixture";

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
  for (const path of ["/projects", "/library", "/apps", "/images"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expectOneMainWithoutOverflow(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create an account", exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Search Library")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect Gmail", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Use Portrait mode style", exact: true }),
    ).toHaveCount(0);
  }
});

test("Library preview traps focus, closes with Escape, and restores its trigger", async ({
  page,
}) => {
  await coreFixture(page, "dark");
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const trigger = page.getByRole("button", { name: "Actions for Release notes" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const previewMenuItem = page.getByRole("menuitem", { name: "Preview", exact: true });
  await expect(previewMenuItem).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Release notes" });
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
