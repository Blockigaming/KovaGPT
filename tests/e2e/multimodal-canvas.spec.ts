import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";

import { waitForKovaHydration } from "./hydration";

test("multimodal surfaces fit the configured viewport", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/images", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("signed-out chat requires an account before exposing uploads or creation tools", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /analyze (data|files)/i })).toHaveCount(0);
});
