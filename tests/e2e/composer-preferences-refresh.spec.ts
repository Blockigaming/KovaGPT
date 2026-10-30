import { test, expect } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const [tier, choices] of [
  ["free", ["instant", "thinking"]],
  ["plus", ["instant", "medium", "thinking", "high"]],
  ["pro", ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"]],
] as const) {
  test(`${tier} composer presents exactly its models and keeps the writing surface quiet`, async ({
    page,
  }, info) => {
    await coreFixture(page, "dark", tier);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await input.click();
    await expect(input).toHaveCSS("outline-style", "none");
    const composer = page.locator(".spec400-composer");
    expect((await composer.boundingBox())!.height).toBeGreaterThanOrEqual(128);
    const picker = composer.getByTestId("model-selector-trigger");
    await expect(picker).toContainText("Default");
    await picker.click();
    const menu = page.getByRole("dialog", { name: /^(Choose model|Models)$/, exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-slot="model-selector-option"]')).toHaveCount(choices.length);
    for (const id of choices) await expect(menu.getByTestId(`model-option-${id}`)).toBeVisible();
    await menu.getByTestId("model-option-thinking").click();
    await expect(picker).toContainText("Thinking");
    await expect(picker.locator("svg")).toHaveCount(2);
    for (const id of choices) {
      await picker.click();
      await page.getByTestId(`model-option-${id}`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await input.fill("A local draft, never sent");
    await expect(composer.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
    await expect(composer.getByTestId("voice-button")).toBeHidden();
    await input.fill("");
    await expect(composer.getByTestId("voice-button")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`${tier}-composer.png`) });
  });
}

test("appearance controls change the application and persist after reload", async ({
  page,
}, info) => {
  await coreFixture(page, "dark", "free", { preserveStorageOnReload: true });
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  const select = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await select("Theme", "Light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await select("Density", "Compact");
  await expect(page.locator("html")).toHaveAttribute("data-kova-density", "compact");
  await select("Text size", "Large");
  await select("Reading width", "Wide");
  await select("Motion", "Reduced");
  await expect(page.locator("html")).toHaveAttribute("data-kova-motion", "reduced");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--kova-reading-size")),
    )
    .toBe("18px");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--kova-reading-width")),
    )
    .toBe("900px");
  await page.reload();
  await waitForKovaHydration(page);
  for (const [label, value] of [
    ["Theme", "Light"],
    ["Density", "Compact"],
    ["Text size", "Large"],
    ["Reading width", "Wide"],
    ["Motion", "Reduced"],
  ])
    await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(value);
  await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toContainText("Dark");
  await expect(page.getByRole("status").filter({ hasText: "Appearance reset" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-appearance.png") });
});

test("Library search uses the same quiet field treatment and filters real rows", async ({
  page,
}, info) => {
  await coreFixture(page, "dark", "free");
  await page.goto("/library");
  await waitForKovaHydration(page);
  const search = page.getByRole("textbox", { name: "Search Library", exact: true });
  await search.fill("Release notes");
  await expect(search).toHaveCSS("outline-style", "none");
  await expect(
    page.getByRole("button", { name: "Release notes", exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Long filename that wraps naturally on a small phone screen", { exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: info.outputPath("library-search.png") });
});

test("every primary settings destination opens its own working section", async ({ page }) => {
  await coreFixture(page, "dark", "free", { preserveStorageOnReload: true });
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  for (const [label, route] of [
    ["Profile", "profile"],
    ["Responses", "responses"],
    ["Memory", "memory"],
    ["Security", "security"],
    ["Storage", "storage"],
    ["Notifications", "notifications"],
    ["Connections", "connections"],
    ["Privacy", "privacy"],
    ["Usage", "usage"],
    ["Subscriptions", "billing"],
    ["Appearance", "appearance"],
  ]) {
    const tab = page.getByRole("tab", { name: label, exact: true });
    if (await tab.isVisible()) await tab.click();
    else {
      await page.getByRole("button", { name: "Section", exact: true }).click();
      await page.getByRole("option", { name: new RegExp(`^${label}(?: Selected)?$`) }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/settings/${route}$`));
    await expect(
      page
        .locator(".kova-settings-content-header")
        .getByRole("heading", { level: 2, name: label, exact: true }),
    ).toBeVisible();
  }
});

test("settings edits reach a chat that is already open in another tab", async ({
  page,
  context,
}) => {
  await coreFixture(page, "dark", "free", { preserveStorageOnReload: true });
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  const chat = await context.newPage();
  await coreFixture(chat, "dark", "free", { preserveStorageOnReload: true });
  await chat.goto("/");
  await waitForKovaHydration(chat);
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(chat.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "Text size", exact: true }).click();
  await page.getByRole("option", { name: "Large", exact: true }).click();
  await expect
    .poll(() =>
      chat.evaluate(() => document.documentElement.style.getPropertyValue("--kova-reading-size")),
    )
    .toBe("18px");
  await chat.close();
});

test("empty home composer matches the two-row writing layout", async ({ page }, info) => {
  await fixture(page, "dark", true, false, "free");
  await page.goto("/");
  await waitForKovaHydration(page);
  const composer = page.locator(".spec400-composer");
  await expect(page.locator(".spec400-chat-input")).toHaveAttribute(
    "data-composer-surface",
    "empty",
  );
  await expect(composer.getByTestId("model-selector-trigger")).toContainText("Default");
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.click();
  await expect(input).toHaveCSS("outline-style", "none");
  await page.screenshot({ path: info.outputPath("home-composer.png") });
});
