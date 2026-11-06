import { expect, test } from "@playwright/test";

for (const width of [320, 768, 1440]) {
  test(`Intelligent Interface keeps next steps visible and submits once at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?surface=intelligent-interface");
    const card = page.getByRole("region", { name: "Choose your next step" });
    await expect(card.getByText("Intelligent Interface", { exact: true })).toBeVisible();
    await expect(card).toHaveAttribute("data-interactive-state", "open");
    for (const button of await card.getByRole("button").all()) {
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 36);
    }
    const primary = card.getByRole("button", { name: /Turn these recommendations/ });
    await primary.focus();
    await page.keyboard.press("Enter");
    const sent = page.getByRole("list", { name: "Sent messages" }).getByRole("listitem");
    await expect(sent).toHaveCount(1);
    await expect(sent).toContainText("Selected: Turn these recommendations");
    await expect(card).toHaveAttribute("data-interactive-state", "submitted");
    await expect(primary).toBeDisabled();
    await expect(card.getByRole("button", { name: "Compare the options" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
