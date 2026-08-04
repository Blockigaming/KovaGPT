import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

test("AI core controls fit the configured viewport", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add files, tools, or prompts" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("search and deep research are reachable from the composer", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  await expect(page.getByRole("button", { name: "Search the web" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep research" })).toBeVisible();
});
