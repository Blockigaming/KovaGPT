import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`offline review navigation ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?surface=public-overview&review=1");
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      const hero = page.locator(".public-hero h1");
      await expect(hero).toHaveCSS("font-weight", "400");
      const accent = await page.locator(".public-hero-accent").evaluate((el) => {
        const color = getComputedStyle(el).color;
        return { color, heading: getComputedStyle(el.parentElement!).color };
      });
      expect(accent.color).not.toEqual(accent.heading);
      const projects = page.getByRole("link", { name: "Explore Projects" });
      await projects.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("You selected /projects");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(projects).toBeFocused();
      if (width < 1024) {
        const menu = page.locator('button[aria-controls="public-mobile-navigation"]');
        await menu.click();
        await page
          .locator("#public-mobile-navigation")
          .getByRole("link", { name: "Pricing", exact: true })
          .click();
        await expect(menu).toHaveAttribute("aria-expanded", "false");
      } else {
        await page.locator(".public-hero").getByRole("link", { name: "Explore plans" }).click();
      }
      await expect(page.getByRole("region", { name: "Plan comparison" })).toBeVisible();
      await expect(page.locator("#main-content")).toBeFocused();
      const overview = page.getByRole("link", { name: "Overview", exact: true });
      await overview.focus();
      await expect(overview).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(hero).toBeVisible();
      await page.locator(".public-hero").getByRole("link", { name: "Open KovaGPT" }).click();
      await expect(dialog).toContainText(
        "This download includes the overview and pricing comparison only",
      );
      await dialog.getByRole("button", { name: "Return to preview" }).click();
      await expect(dialog).not.toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    });
  }
}

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
      const included = region.getByRole("columnheader", { name: "Included", exact: true });
      await expect
        .poll(async () => {
          const [regionBox, includedBox] = await Promise.all([
            region.boundingBox(),
            included.boundingBox(),
          ]);
          if (!regionBox || !includedBox) return false;
          return (
            includedBox.x >= regionBox.x &&
            includedBox.x + includedBox.width <= regionBox.x + regionBox.width
          );
        })
        .toBe(true);
      expect(await region.evaluate((el) => el.scrollLeft)).toBe(0);
      await page.screenshot({ path: info.outputPath("comparison.png"), fullPage: true });

      await region.focus();
      await expect(region).toBeFocused();
      if (width < 672) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await page.screenshot({
          path: info.outputPath("comparison-scrolled.png"),
          fullPage: true,
        });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }
}
