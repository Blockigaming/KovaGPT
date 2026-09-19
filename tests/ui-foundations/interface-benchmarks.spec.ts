import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`overview and comparison ${width}px ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/?surface=public-overview");
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Your ideas.A little further.",
      );
      const choices = page.getByRole("group", { name: "Choose an example" });
      const answer = page.locator("#workflow-example-content");
      for (const [label, heading] of [
        ["Learn", "Make room for the next question."],
        ["Plan", "Give the work a place to start."],
        ["Write", "Find the thread in your ideas."],
      ]) {
        await choices.getByRole("button", { name: label, exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(answer.getByRole("heading", { name: heading })).toBeVisible();
        await expect(choices.locator('[aria-pressed="true"]')).toHaveText(label);
      }
      const faq = page.locator("summary").filter({ hasText: "Can I trust every answer?" });
      await faq.focus();
      await page.keyboard.press("Enter");
      await expect(faq.locator("..")).toHaveAttribute("open", "");
      await expect(faq.locator("..")).toContainText("AI can make mistakes");
      await page.keyboard.press("Enter");
      await expect(faq.locator("..")).not.toHaveAttribute("open", "");
      if (width < 1024) {
        const menu = page.locator('button[aria-controls="public-mobile-navigation"]');
        await menu.click();
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await expect(menu).toHaveAccessibleName("Close navigation");
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
        await expect(menu).toHaveAttribute("aria-expanded", "false");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("overview.png"), fullPage: true });
      await page.goto("/?surface=public-comparison");
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const region = page.getByRole("region", { name: "Plan comparison" });
      await expect(region.getByRole("columnheader")).toHaveText([
        "Included",
        "Free",
        "Plus",
        "Pro",
      ]);
      await expect(region.getByRole("rowheader")).toHaveText([
        "Chat modes",
        "Chat",
        "Images",
        "Uploads",
        "Storage",
      ]);
      await region.focus();
      await expect(region).toBeFocused();
      if (width < 672) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("comparison.png"), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
