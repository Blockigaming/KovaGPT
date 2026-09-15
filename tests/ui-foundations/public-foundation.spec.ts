import { expect, test } from "@playwright/test";

const widths = [320, 390, 768, 1024, 1280, 1440, 1728];
const surfaces = ["public-landing", "public-detail", "public-seo", "public-legal"];
const question = "Can I keep a long project reference without losing its complete text?";

for (const width of widths)
  for (const theme of ["light", "dark"] as const)
    for (const textScale of [1, 2]) {
      test(`public foundation ${width} ${theme} ${textScale}x text`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const surface of surfaces) {
          await test.step(surface, async () => {
            await page.goto(`/?surface=${surface}`);
            await page.evaluate(
              ({ theme, textScale }) => {
                document.documentElement.classList.toggle("dark", theme === "dark");
                document.documentElement.dataset.largeText = String(textScale === 2);
              },
              { theme, textScale },
            );
            await expect(page.locator("main#main-content")).toHaveCount(1);
            await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
            await expect(page.getByRole("contentinfo")).toBeVisible();
            await expect(
              page.getByRole("navigation", { name: "Public navigation", exact: true }),
            ).toBeVisible();
            await expect
              .poll(() =>
                page.locator("[data-public-shell]").evaluate((element) => {
                  const recorded = parseFloat(
                    getComputedStyle(element).getPropertyValue("--kova-public-header-height"),
                  );
                  return Math.abs(
                    recorded - element.querySelector("header")!.getBoundingClientRect().height,
                  );
                }),
              )
              .toBeLessThanOrEqual(1);
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              ),
            ).toBeLessThanOrEqual(1);
            const breadcrumb = page.locator("[data-public-breadcrumb]");
            if (await breadcrumb.count()) {
              expect((await breadcrumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
              await breadcrumb.focus();
              await expect(breadcrumb).toBeFocused();
            }
            if (width < 1024) {
              const toggle = page.locator('button[aria-controls="public-mobile-navigation"]');
              await toggle.click();
              await expect(toggle).toHaveAttribute("aria-expanded", "true");
              await page.keyboard.press("Tab");
              await expect(
                page
                  .getByRole("navigation", { name: "Mobile public navigation" })
                  .getByRole("link")
                  .first(),
              ).toBeFocused();
              await page.keyboard.press("Escape");
              await expect(toggle).toBeFocused();
              await expect(toggle).toHaveAttribute("aria-expanded", "false");
            }
            if (surface === "public-detail" || surface === "public-seo") {
              const summary = page.locator("summary").filter({ hasText: question });
              await summary.scrollIntoViewIfNeeded();
              await summary.focus();
              await page.keyboard.press("Space");
              await expect(summary.locator("..")).toHaveAttribute("open", "");
              expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
              await expect(summary.locator("span[aria-hidden]")).toHaveCSS(
                "transition-duration",
                "0s",
              );
              const outline = await summary.evaluate((element) => {
                const css = getComputedStyle(element);
                return css.outlineStyle !== "none" || css.boxShadow !== "none";
              });
              expect(outline, "keyboard focus must be visible").toBe(true);
              await page.keyboard.press("Space");
              await expect(summary.locator("..")).not.toHaveAttribute("open", "");
              await expect(summary).toBeFocused();
            }
            const footerLink = page
              .getByRole("navigation", { name: "Footer navigation" })
              .getByRole("link")
              .first();
            await footerLink.focus();
            await expect(footerLink).toBeFocused();
            expect((await footerLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            // Reviewable representative visuals, not a claim that every content page is finished.
            if ((width === 390 || width === 1440) && textScale === 1) {
              await page.evaluate(() => window.scrollTo(0, 0));
              await page.screenshot({
                path: info.outputPath(`${surface}-${width}-${theme}.png`),
                fullPage: true,
              });
            }
          });
        }
        expect(errors).toEqual([]);
      });
    }

test("public states communicate status without fake activation or duplicate landmarks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const kind of ["loading", "empty", "unavailable", "error"]) {
    await page.goto(`/?surface=public-state-${kind}`);
    await expect(page.getByRole("main")).toHaveCount(1);
    const state = page.locator(`[data-public-state="${kind}"]`);
    await expect(state.getByRole(kind === "error" ? "alert" : "status")).toBeVisible();
    await expect(state.getByRole("link")).toHaveCount(kind === "loading" ? 0 : 1);
    expect(
      await state.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});
