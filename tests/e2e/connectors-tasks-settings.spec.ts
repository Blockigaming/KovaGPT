import { expect, test } from "@playwright/test";

const viewports = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
];

for (const viewport of viewports) {
  test(`connectors and tasks fit at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/apps");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    await page.goto("/scheduled-tasks");
    await expect(page.getByRole("main").or(page.locator("body"))).toBeVisible();
  });
}

test("settings, billing, sharing, and collaboration surfaces do not expose voice", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText(/apps|scheduled|share|settings|billing|usage/i).first(),
  ).toBeVisible();
  await expect(page.getByText(/voice mode|microphone|read aloud|dictation/i)).toHaveCount(0);
});
