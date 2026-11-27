import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
test.beforeEach(async ({ page }) => {
  await installAuthenticatedFixture(page);
});

import { waitForKovaHydration } from "./hydration";
import { chooseSettingsSection, openCurrentSettings } from "./current-ui";

test("connected apps and scheduled tasks fit the configured viewport", async ({ page }) => {
  await page.goto("/apps", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");

  await page.goto("/scheduled-tasks", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("Settings remains reachable from the responsive shell", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  const settings = await openCurrentSettings(page);
  // Settings opens on its home list; choose Appearance explicitly.
  await chooseSettingsSection(page, "Appearance");
  await expect(settings.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Theme", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
});

test("dark workspace dims behind Search chats and Settings and clears on close", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "dark"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const phonePalette = await page.evaluate(
    () =>
      matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
        .matches,
  );
  const background = phonePalette ? "rgb(17, 17, 17)" : "rgb(25, 25, 25)";
  const themeColor = phonePalette ? "#111111" : "#191919";
  const canvas = page.locator(".kova-chat-main");
  await expect(canvas).toHaveCSS("background-color", background);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", themeColor);

  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
  await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0.52)");
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(canvas).toHaveCSS("background-color", background);

  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  const settings = await openCurrentSettings(page);
  const overlay = page.locator('[data-slot="dialog-overlay"][data-state="open"]');
  await expect(overlay).toHaveCSS("background-color", "rgba(0, 0, 0, 0.52)");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(canvas).toHaveCSS("background-color", background);
});
