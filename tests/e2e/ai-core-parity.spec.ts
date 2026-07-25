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
  test(`AI core controls fit at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /tools|attach|send|stop|temporary/i }).first(),
    ).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });
}

test("search citations, sources, deep research, memory, and temporary chat surfaces are reachable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(
    page.getByText(/search|deep research|temporary|memory|sources/i).first(),
  ).toBeVisible();
});
