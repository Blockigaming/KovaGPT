import { test, expect, type Page } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
async function expectInactiveSelection(page: Page) {
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator(".kova-model-static:visible").first()).toHaveText("KovaGPT");
  await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
  await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary workspace" })).toHaveCount(0);
  expect(chatRequests).toBe(0);
}
test("Free selection stays inactive until a serving contract is accepted", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "free" });
  await expectInactiveSelection(page);
});
test("Plus selection stays inactive until a serving contract is accepted", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "plus" });
  await expectInactiveSelection(page);
});
test("Pro selection stays inactive until a serving contract is accepted", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "pro" });
  await expectInactiveSelection(page);
});
test("signed-out identity does not offer an unverified model or upgrade", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("https://*.supabase.co/**", (route) => route.abort("blockedbyclient"));
  await expectInactiveSelection(page);
});
