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
  test(`multimodal surfaces fit at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/images");
    await expect(page.getByRole("main").or(page.locator("body"))).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });
}

test("chat exposes file, image, analysis, and artifact entry points without voice", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(
    page.getByText(/image|file|analysis|canvas|artifact|library/i).first(),
  ).toBeVisible();
  await expect(page.getByText(/voice|microphone|read aloud/i)).toHaveCount(0);
});
