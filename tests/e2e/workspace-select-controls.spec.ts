import { expect, test, type Locator, type Page } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

async function boundedPopup(page: Page) {
  const popup = page.getByRole("listbox");
  await expect(popup).toBeVisible();
  const geometry = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.radius).toBeGreaterThan(0);
  return popup;
}

async function choose(page: Page, control: Locator, option: string) {
  await control.click();
  const popup = await boundedPopup(page);
  const item = popup.getByRole("option", { name: option, exact: true });
  // Settle viewport scroll controls before click calculates a stable pointer target.
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(control).toContainText(option);
}

async function dismissWithKeyboard(page: Page, control: Locator) {
  await control.focus();
  await control.press("ArrowDown");
  await boundedPopup(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(control).toBeFocused();
}

for (const theme of ["light", "dark"] as const) {
  test(`Library menus keep filters, sorting and nested focus in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await coreFixture(page, theme, "free", { preserveStorageOnReload: true });
    await page.goto("/library");
    await waitForKovaHydration(page);
    const sort = page.getByRole("combobox", { name: "Sort Library", exact: true });
    await expect(sort).toContainText("Date saved, newest first");
    await dismissWithKeyboard(page, sort);
    await choose(page, sort, "Name");

    const filters = page.getByRole("button", { name: /^Filters/ });
    await filters.click();
    const panel = page.locator(".spec400-library-filter-panel");
    const source = panel.getByRole("combobox", { name: "Source", exact: true });
    const date = panel.getByRole("combobox", { name: "Date saved", exact: true });
    await dismissWithKeyboard(page, source);
    await expect(panel).toBeVisible();
    await choose(page, source, "Manual");
    await choose(page, date, "Last 90 days");
    await source.click();
    await boundedPopup(page);
    await page.screenshot({
      path: info.outputPath(`library-source-menu-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(source).toBeFocused();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(filters).toBeFocused();

    const rows = page.locator(".kova-file-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Long filename that wraps naturally");
    await expect(page.getByRole("button", { name: "Source: manual", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Last 90 days", exact: true })).toBeVisible();
    await page.reload();
    await waitForKovaHydration(page);
    await expect(sort).toContainText("Name");
    await expect(rows).toHaveCount(2);
    await filters.click();
    await expect(source).toContainText("Manual");
    await expect(date).toContainText("Last 90 days");
    await choose(page, source, "All sources");
    await choose(page, date, "Any time");
    await page.keyboard.press("Escape");
    await expect(rows).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test(`Settings menus keep response and workspace preferences in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await coreFixture(page, theme, "free", { preserveStorageOnReload: true });
    await page.goto("/settings/responses");
    await waitForKovaHydration(page);
    const settings = page.locator(".kova-settings-dialog");
    const format = settings.getByRole("combobox", { name: "Format", exact: true });
    const tone = settings.getByRole("combobox", { name: "Tone", exact: true });
    await expect(format).toContainText("Automatic");
    await dismissWithKeyboard(page, format);
    await format.press("ArrowDown");
    await boundedPopup(page);
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "Automatic", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Plain text", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(format).toContainText("Plain text");
    await expect(format).toBeFocused();
    await choose(page, tone, "Formal");

    for (const [label, option] of [
      ["Project defaults", "Detailed instructions"],
      ["Work defaults", "Manual steps"],
      ["Prompt defaults", "Coding"],
      ["Research defaults", "Primary sources"],
      ["Artifact defaults", "Split view"],
    ]) {
      const control = settings.getByRole("combobox", { name: label, exact: true });
      await choose(page, control, option);
      const targetHeight = await page.evaluate(() =>
        matchMedia("(pointer: coarse)").matches ? "44px" : "36px",
      );
      await expect(control).toHaveCSS("height", targetHeight);
    }
    const artifact = settings.getByRole("combobox", { name: "Artifact defaults", exact: true });
    if (page.viewportSize()!.width >= 1440) {
      const navigation = settings.getByRole("complementary", {
        name: "Settings navigation",
        exact: true,
      });
      await expect(navigation.getByRole("tab", { name: "Responses", exact: true })).toBeInViewport({
        ratio: 1,
      });
      await expect(navigation.getByRole("tab", { name: "Billing", exact: true })).toBeInViewport({
        ratio: 1,
      });
    }
    await artifact.click();
    await boundedPopup(page);
    await page.screenshot({
      path: info.outputPath(`settings-workspace-menu-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(artifact).toBeFocused();
    await page.reload();
    await waitForKovaHydration(page);
    await expect(format).toContainText("Plain text");
    await expect(tone).toContainText("Formal");
    await expect(artifact).toContainText("Split view");
    await expect(
      settings.getByRole("combobox", { name: "Project defaults", exact: true }),
    ).toContainText("Detailed instructions");
    if (page.viewportSize()!.width >= 1440) {
      await page.setViewportSize({ width: 1440, height: 420 });
      await artifact.scrollIntoViewIfNeeded();
      const navigation = settings.getByRole("complementary", {
        name: "Settings navigation",
        exact: true,
      });
      await expect(
        navigation.getByRole("textbox", { name: "Search settings", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const billing = navigation.getByRole("tab", { name: "Billing", exact: true });
      await billing.scrollIntoViewIfNeeded();
      await expect(billing).toBeInViewport({ ratio: 1 });
      await billing.click();
      await expect(page).toHaveURL(/\/settings\/billing$/);
      await expect(settings.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
