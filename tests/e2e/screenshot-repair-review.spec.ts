import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: review home, navigation and routable Appearance`, async ({ page }, info) => {
    await installAuthenticatedFixture(page);
    await page.addInitScript((mode) => {
      localStorage.setItem("kova-theme-mode", mode);
      localStorage.setItem("kova-sidebar-open", "1");
    }, theme);
    await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
    await page.route("**/_serverFn/**", (route) =>
      route.fulfill({ json: { result: [], context: {} } }),
    );
    await page.goto("/");
    await waitForKovaHydration(page);
    await expect(page.locator("#chat-greeting")).toBeVisible();
    await expect(page.locator("#chat-greeting")).not.toHaveText("");
    await expect(page.locator(".spec400-composer")).toBeVisible();
    if (info.project.name.includes("desktop")) {
      await expect(
        page.getByRole("link", { name: "Connections", exact: true }).filter({ visible: true }),
      ).toBeVisible();
    }
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await expect(page.getByRole("button", { name: "Voice", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).not.toBeVisible();
    const voiceBox = await page
      .getByRole("button", { name: "Voice", exact: true })
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        const composer = el.closest(".spec400-composer")!.getBoundingClientRect();
        return { x: box.x - composer.x, y: box.y - composer.y };
      });
    await input.fill("A draft that stays editable");
    await expect(page.getByRole("button", { name: "Voice", exact: true })).not.toBeVisible();
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await expect(send).toBeVisible();
    const sendBox = await send.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const composer = el.closest(".spec400-composer")!.getBoundingClientRect();
      return { x: box.x - composer.x, y: box.y - composer.y };
    });
    expect(Math.abs(sendBox!.x - voiceBox!.x)).toBeLessThan(1);
    expect(Math.abs(sendBox!.y - voiceBox!.y)).toBeLessThan(1);
    await input.blur();
    await page
      .locator(".spec400-composer")
      .screenshot({ path: info.outputPath(`composer-typed-${theme}.png`), animations: "disabled" });
    await expect(input).toHaveValue("A draft that stays editable");
    await input.fill("");
    await input.blur();
    await expect(page.getByRole("button", { name: "Voice", exact: true })).toBeVisible();
    await page
      .locator(".spec400-composer")
      .screenshot({ path: info.outputPath(`composer-empty-${theme}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`home-${theme}.png`), animations: "disabled" });
    if (info.project.name.includes("desktop")) {
      const logo = page.locator(".kova-sidebar-brand img");
      await expect(logo).toHaveAttribute("src", "/kova-logo.png");
      await expect
        .poll(() => logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
      await expect(
        page.getByRole("link", { name: "Connections", exact: true }).filter({ visible: true }),
      ).toBeVisible();
      const icons = page.locator("[data-kova-navigation-glyph]").filter({ visible: true });
      for (const icon of await icons.all()) await expect(icon).toHaveCSS("stroke", "none");
    }
    await page.goto("/settings/appearance");
    await waitForKovaHydration(page);
    const themeControl = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(themeControl).toBeVisible();
    await themeControl.click();
    for (const option of ["Dark", "Light", "System"])
      await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(themeControl).toBeFocused();
    if (info.project.name.includes("desktop")) {
      await expect(page.locator(".kova-settings-sidebar")).toBeVisible();
      await expect(page.locator(".kova-settings-section-select")).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`appearance-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: Settings reference layout uses the selected theme and working sections`, async ({
    page,
  }, info) => {
    await installAuthenticatedFixture(page);
    await page.addInitScript((mode) => localStorage.setItem("kova-theme-mode", mode), theme);
    await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
    await page.route("**/_serverFn/**", (route) =>
      route.fulfill({ json: { result: [], context: {} } }),
    );
    await page.goto("/settings/responses");
    await waitForKovaHydration(page);
    const screen = page.locator(".kova-settings-screen");
    const panel = page.locator("section.kova-settings-page");
    await expect(screen).toBeVisible();
    await expect(page.getByRole("heading", { name: "General", exact: true }).first()).toBeVisible();
    if (page.viewportSize()!.width >= 768) {
      await expect(page.getByRole("combobox", { name: "Send shortcut" })).toBeVisible();
    } else {
      await expect(page.getByRole("combobox", { name: "Send shortcut" })).toHaveCount(0);
    }
    await expect(page.getByRole("combobox", { name: "Preferred response length" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const screen = document.querySelector(".kova-settings-screen")!;
          const content = document.querySelector("section.kova-settings-page")!;
          return (
            getComputedStyle(screen).backgroundColor === getComputedStyle(content).backgroundColor
          );
        }),
      )
      .toBe(true);
    if (page.viewportSize()!.width >= 768) {
      const nav = page.getByRole("complementary", { name: "Settings navigation" });
      await expect(nav).toBeVisible();
      const geometry = await nav.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, border: getComputedStyle(node).borderRightWidth };
      });
      if (page.viewportSize()!.width < 1024) expect(geometry.width).toBe(240);
      else expect(geometry.width).toBeGreaterThan(270);
      expect(geometry.border).toBe("1px");
      await nav.getByRole("tab", { name: "Appearance", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Back to settings" }).click();
      await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
    await panel.screenshot({
      path: info.outputPath(`settings-reference-${theme}.png`),
      animations: "disabled",
    });
  });
}
