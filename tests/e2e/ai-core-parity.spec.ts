import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";
import { fixture } from "./actual-app-fixture";

test("AI core controls fit the configured viewport", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
