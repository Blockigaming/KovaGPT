import { usesCompactSettings } from "./settings-layout-fixture";
import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: Settings uses device-specific navigation and reachable secondary pages`, async ({
    page,
  }) => {
    await coreFixture(page, theme, "pro");
    await page.goto("/settings/responses");
    await waitForKovaHydration(page);
    const phone = await usesCompactSettings(page);
    const navigation = page.getByRole("complementary", { name: "Settings navigation" });
    const content = page.locator(".kova-settings-content");
    if (phone) {
      await expect(navigation).toBeHidden();
      await page.getByRole("button", { name: "Back to settings", exact: true }).click();
      await expect(navigation).toBeVisible();
      await expect(page.locator(".kova-settings-navigation-heading h2")).toBeFocused();
      await expect(page.getByPlaceholder("Search settings")).not.toBeFocused();
      const tabs = navigation.getByRole("tab");
      await expect(tabs).toHaveCount(22);
      for (const tab of await tabs.all()) {
        const box = (await tab.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
    } else {
      await expect(navigation).toBeVisible();
      await expect(content).toBeVisible();
      const navBox = (await navigation.boundingBox())!;
      const contentBox = (await content.boundingBox())!;
      expect(navBox.x + navBox.width).toBeLessThanOrEqual(contentBox.x + 8);
    }
    await navigation.getByRole("tab", { name: "Data controls", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Data controls", exact: true })).toBeVisible();
    if (phone) {
      await page.getByRole("button", { name: "Back to settings", exact: true }).click();
      await expect(navigation).toBeVisible();
    }
    await navigation.getByRole("tab", { name: "Security and login", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Security and login", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`${theme}: Settings controls fit their cards and phone inputs avoid automatic zoom`, async ({
    page,
  }) => {
    // Each deep link redirects to chat and opens the Settings modal there.
    test.setTimeout(90000);
    await coreFixture(page, theme, "pro");
    for (const section of [
      "responses",
      "appearance",
      "profile",
      "privacy",
      "notifications",
      "billing",
    ]) {
      await page.goto(`/settings/${section}`);
      await waitForKovaHydration(page);
      const content = page.locator(".kova-settings-content");
      await expect(content).toBeVisible({ timeout: 15_000 });
      const issues = await content
        .locator('input:not([type="checkbox"]):not([type="radio"]), textarea, [role="combobox"]')
        .evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const box = node.getBoundingClientRect();
            if (!box.width || !box.height) return [];
            const card = node.closest(".kova-settings-card, .kova-settings-section, section");
            const parent = card?.getBoundingClientRect();
            return [
              ...(box.x < 0 || box.right > innerWidth + 1
                ? [`outside viewport: ${node.getAttribute("aria-label") || node.tagName}`]
                : []),
              ...(parent && (box.left < parent.left - 1 || box.right > parent.right + 1)
                ? ["outside card"]
                : []),
              ...(innerWidth < 768 &&
              node.matches("input, textarea") &&
              parseFloat(getComputedStyle(node).fontSize) < 16
                ? ["phone input below 16px"]
                : []),
            ];
          }),
        );
      expect(issues, section).toEqual([]);
      if (section === "appearance") {
        const font = content.getByRole("combobox", { name: "Interface font", exact: true });
        await expect(font).toContainText("System");
        const fit = await content.evaluate((pane) => {
          const left = (selector: string) =>
            pane.querySelector(selector)!.getBoundingClientRect().left;
          const clippedValues = [
            ...pane.querySelectorAll(".kova-preference-row [role='combobox'] > span"),
          ]
            .filter(
              (value) =>
                value.getBoundingClientRect().width && value.scrollWidth > value.clientWidth + 1,
            )
            .map((value) => value.textContent);
          return {
            labelOffset: Math.abs(
              left(".kova-preference-slider-label") -
                left(".kova-preference-list .kova-preference-row"),
            ),
            clippedValues,
          };
        });
        expect(fit.labelOffset).toBeLessThanOrEqual(1);
        expect(fit.clippedValues).toEqual([]);
        if (page.viewportSize()!.width <= 390) {
          const interfaceSize = content.getByRole("slider", {
            name: "Interface size",
            exact: true,
          });
          await interfaceSize.press("End");
          await expect(interfaceSize).toHaveAttribute("aria-valuetext", "125%");
          const reset = content.getByRole("button", { name: "Reset appearance", exact: true });
          const paneBox = (await content.boundingBox())!;
          const resetBox = (await reset.boundingBox())!;
          expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
        }
      }
      if (section === "appearance" && page.viewportSize()!.width < 768) {
        const widths = await content
          .locator('.kova-preference-row [role="combobox"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              control: node.getBoundingClientRect().width,
              row: node.parentElement!.getBoundingClientRect().width,
            })),
          );
        for (const width of widths)
          expect(Math.abs(width.control - width.row)).toBeLessThanOrEqual(1);
      }
    }
  });
}

test("every Settings destination loads from its route without clipping", async ({ page }) => {
  test.setTimeout(240000);
  await coreFixture(page, "dark", "pro");
  for (const section of [
    "profile",
    "voice",
    "appearance",
    "responses",
    "notifications",
    "connections",
    "cloud-browser",
    "privacy",
    "usage",
    "billing",
    "memory",
    "security",
    "storage",
    "shortcuts",
    "email",
    "parental",
    "report",
    "help",
    "about",
    "location",
    "family",
  ]) {
    await page.goto(`/settings/${section}`);
    await waitForKovaHydration(page);
    await expect(
      page.locator('.kova-settings-content > [role="tabpanel"][data-state="active"]'),
    ).toBeVisible({ timeout: 15_000 });
    const pane = page.locator(".kova-settings-content");
    expect(
      await pane.evaluate((node) => node.scrollWidth - node.clientWidth),
      section,
    ).toBeLessThanOrEqual(1);
    const heading = page.locator(".kova-settings-content-header h2");
    await expect(heading).toBeVisible();
    const box = (await heading.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
});

test("phone Library keeps sort readable beside favorites and view controls", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768);
  await coreFixture(page, "dark", "pro");
  await page.goto("/library");
  await waitForKovaHydration(page);
  const sort = page.getByRole("combobox", { name: "Sort Library" });
  await expect(sort).toBeVisible();
  expect((await sort.boundingBox())!.width).toBeGreaterThanOrEqual(100);
  await sort.click();
  await page.getByRole("option", { name: "Name", exact: true }).click();
  await expect(sort).toContainText("Name");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
