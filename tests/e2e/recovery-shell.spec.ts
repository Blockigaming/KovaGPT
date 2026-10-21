import { test, expect } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";
test("workspace search is reachable by touch and restores usable chat", async ({ page }, info) => {
  await coreFixture(page, "dark", "free");
  await page.goto("/");
  await waitForKovaHydration(page);
  const open = page
    .getByRole("button", { name: /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/ })
    .filter({ visible: true });
  await open.first().click();
  await page.getByRole("button", { name: "Search workspace", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: info.outputPath("workspace-search.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
});
