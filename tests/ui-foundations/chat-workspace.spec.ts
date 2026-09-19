import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1024, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`actual workspace components ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto("/workspace.html");
      await page.evaluate(
        (t) => document.documentElement.classList.toggle("dark", t === "dark"),
        theme,
      );
      const input = page.getByRole("textbox", { name: "Message KovaGPT" });
      await expect(input).toBeVisible();
      await expect(page.locator("[data-workspace-fixture]")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const area = await input.boundingBox();
      expect(area!.width).toBeGreaterThan(150);
      await page.screenshot({ path: testInfo.outputPath("workspace.png") });

      if (width < 1024) await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const sidebar = page.locator('aside[aria-label="Primary navigation"]');
      await expect(sidebar).toBeVisible();
      const row = await sidebar
        .getByRole("button", { name: "New chat", exact: true })
        .boundingBox();
      expect(row!.height).toBeLessThanOrEqual(width < 1024 ? 45 : 40);
      expect(row!.height).toBeGreaterThanOrEqual(width < 1024 ? 44 : 36);
      await sidebar.getByRole("button", { name: "Search chats", exact: true }).click();
      await expect(sidebar.getByRole("textbox", { name: "Search chats" })).toBeFocused();
      await sidebar.getByRole("button", { name: "More", exact: true }).click();
      await expect(sidebar.getByRole("button", { name: "Health Coming soon" })).toBeDisabled();
      await expect(sidebar.getByRole("button", { name: "Finances Coming soon" })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath("navigation.png") });
      await sidebar.getByRole("button", { name: "Help", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Help requested");
      if (width < 1024) {
        await expect(sidebar).toHaveAttribute("aria-hidden", "true");
        await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
      }
      const add = page.getByRole("button", { name: "Add files, tools, or prompts", exact: true });
      await add.click();
      await expect(
        page.getByRole("dialog", {
          name: width < 1024 ? "Add to your message" : "Add files, tools, or prompts",
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(add).toBeFocused();
      await input.fill("Check the available typing space without sending.");
      await page.screenshot({ path: testInfo.outputPath("composer-focus.png") });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
    });
  }
}

test("member mobile header retains Kova branding and changes a real model selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace.html?session=member");
  const trigger = page.getByTestId("model-selector-trigger").filter({ visible: true });
  await expect(trigger).toHaveText("KovaGPT");
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Intelligence" })).toBeVisible();
  const option = page.locator('[data-testid^="model-option-"]').filter({ visible: true }).last();
  await option.click();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("KovaGPT");
});
