import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

test("multimodal surfaces fit the configured viewport", async ({ page }) => {
  await page.goto("/images", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("chat exposes file, image, and analysis entry points", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  for (const name of ["Photos", "Files", "Create an image", "Analyze data", "Analyze files"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});
