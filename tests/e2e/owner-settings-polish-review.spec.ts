import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: owner Settings polish review captures real application screens`, async ({
    page,
  }, info) => {
    test.skip(!["desktop-1440x900", "phone-390x844"].includes(info.project.name));
    test.setTimeout(90_000);
    await coreFixture(page, theme, "pro");
    const capture = async (name: string) => {
      await page.screenshot({
        path: info.outputPath(`${theme}-${name}.png`),
        animations: "disabled",
      });
    };
    const open = async (section: string) => {
      await page.goto(`/settings/${section}`);
      await waitForKovaHydration(page);
      const content = page.locator(".kova-settings-content");
      await expect(content).toBeVisible();
      return content;
    };

    if (info.project.name === "desktop-1440x900") {
      await page.goto("/");
      await waitForKovaHydration(page);
      const sidebar = await revealSidebar(page);
      await sidebar.getByRole("button", { name: "New chat", exact: true }).click();
      const cards = page.locator(".kova-desktop-recent-work button");
      await expect(cards).toHaveCount(2);
      const heights = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
      await capture("continue-working");
    }

    await open("privacy");
    await capture("data-controls");
    const back = page.getByRole("button", { name: "Back to settings", exact: true });
    if (await back.isVisible()) await back.click();
    const navigation = page.getByRole("complementary", { name: "Settings navigation" });
    const active = navigation.getByRole("tab", { name: "Data controls", exact: true });
    await expect(active).toHaveAttribute("aria-selected", "true");
    await expect(active).not.toHaveCSS("box-shadow", "none");
    await expect(navigation.getByRole("tab", { name: "About", exact: true })).toHaveCount(0);
    if (info.project.name === "desktop-1440x900") {
      await navigation.getByRole("tab", { name: "Appearance", exact: true }).hover();
      await expect(active).not.toHaveCSS("box-shadow", "none");
    }
    await capture("settings-selection");
    const search = navigation.getByPlaceholder("Search settings");
    await search.fill("pri");
    const results = navigation.getByRole("group", { name: "Matching settings" });
    await expect(results).toBeVisible();
    await expect(results.locator("mark").first()).toBeVisible();
    await expect(navigation.getByRole("tab")).toHaveCount(21);
    await capture("settings-search");
    await results.getByRole("button", { name: "Data controls", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Data controls", exact: true })).toBeVisible();

    const browser = await open("cloud-browser");
    const rule = browser.getByLabel("Rule", { exact: true });
    await rule.scrollIntoViewIfNeeded();
    expect((await rule.boundingBox())!.width).toBeGreaterThanOrEqual(100);
    await capture("cloud-browser-rule");

    const billing = await open("billing");
    for (const name of ["Overview", "Plans", "Invoices"]) {
      const tab = billing.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(tab).toHaveCSS("border-top-left-radius", "999px");
      await capture(`subscriptions-${name.toLowerCase()}`);
    }

    const connections = await open("connections");
    const logos = connections.locator(".spec400-plugin-logo img");
    await expect(logos.first()).toBeVisible();
    await expect
      .poll(() => logos.first().evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0);
    await capture("connection-logos");
  });
}
