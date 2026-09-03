import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

test("multimodal surfaces fit the configured viewport", async ({ page }) => {
  await page.goto("/images", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("signed-out chat exposes uploads without advertising unavailable tools", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  for (const name of ["Photos", "Files"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('[aria-disabled="true"]', { hasText: "Create image" })).toBeVisible();
  await expect(page.getByRole("button", { name: /analyze (data|files)/i })).toHaveCount(0);
});
