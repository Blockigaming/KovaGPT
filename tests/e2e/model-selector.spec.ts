import { test, expect } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

test("signed-out shell keeps model switching unavailable", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator('[data-testid="model-selector-trigger"]')).toHaveCount(0);
  await expect(page.getByText("KovaGPT", { exact: true }).first()).toBeVisible();
});
