import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: developer workspace fits the viewport and navigates its console sections`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await coreFixture(page, theme, "pro");
    await page.route("**/api/developer/console?**", async (route) => {
      await route.fulfill({
        json: {
          enabled: false,
          accounts: [],
          projects: [],
          keys: [],
          limits: [],
          balances: [],
          usage: [],
          limitsPage: 0,
          limitsHasMore: false,
          usagePage: 0,
          usageHasMore: false,
        },
      });
    });
    await page.goto("/developers/console");
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Developer workspace" });
    const mobile = (page.viewportSize()?.width ?? 1440) < 768;
    const destinations = [
      ["Projects", "projects"],
      ["API keys", "keys"],
      ["Models", "models"],
      ["Files", "files"],
      ["Usage", "usage"],
      ["Costs", "costs"],
      ["Logs", "logs"],
      ["Billing", "billing"],
      ["Limits", "limits"],
      ["Settings", "settings"],
    ] as const;
    for (const [label, section] of destinations) {
      if (mobile) {
        await expect(navigation).toBeHidden();
        await page.getByRole("button", { name: "Open developer navigation" }).click();
      }
      await expect(navigation).toBeVisible();
      await navigation.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`section=${section}(?:&|$)`));
      if (mobile) await expect(navigation).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), section).toBe(true);
      const clipped = await page.locator("[data-developer-workspace] main input:visible, [data-developer-workspace] main button:visible, [data-developer-workspace] main [role=combobox]:visible").evaluateAll((nodes) =>
        nodes.filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
        }).map((node) => node.textContent || node.getAttribute("aria-label") || node.tagName),
      );
      expect(clipped, section).toEqual([]);
    }
    // Deliberately do not create keys, credits, payments or provider requests.
  });
}
