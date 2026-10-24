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
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const mobile = page.viewportSize()!.width < 768;
  for (const name of mobile ? ["Photos", "Files"] : ["Photos & Files"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page
    .getByRole("button", { name: mobile ? "Files" : "Photos & Files", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to continue", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Sign in to continue", exact: true })
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toHaveValue("");
  await expect(page.getByRole("button", { name: /analyze (data|files)/i })).toHaveCount(0);
});
