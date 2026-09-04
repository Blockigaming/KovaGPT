import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

test.describe("mobile shell UI truth", () => {
  test("the phone drawer fills the viewport and restores focus", async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(
      !viewport || (viewport.width >= 768 && viewport.height >= 500),
      "phone portrait and landscape drawer contract",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const opener = page.getByRole("button", { name: "Open menu" });
    await opener.focus();
    await opener.click();

    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThanOrEqual(1);
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);

    const close = page.getByRole("button", { name: "Close navigation", exact: true });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(opener).toBeFocused();
  });

  test("the command palette is unclipped, motion-safe, and restores its opener", async ({
    page,
  }) => {
    const viewport = page.viewportSize()!;

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    const opener =
      viewport.width < 1024
        ? page.getByRole("button", { name: "Open menu" })
        : page.getByRole("button", { name: "Search chats" }).first();
    await opener.focus();
    const openerHandle = await opener.elementHandle();
    expect(openerHandle).not.toBeNull();
    await page.keyboard.press("Control+K");

    const palette = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
    await expect(palette).toBeVisible();
    await expect(
      palette.getByRole("combobox", { name: "Search workspace, commands, and chats" }),
    ).toBeFocused();
    const paletteBox = await palette.boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(paletteBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);

    const close = page.getByRole("button", { name: "Close command palette" });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);

    const panel = palette.locator(":scope > div").first();
    const animationDuration = await panel.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).animationDuration) || 0,
    );
    expect(animationDuration).toBeLessThanOrEqual(0.01);

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect
      .poll(() => openerHandle!.evaluate((element) => element === document.activeElement))
      .toBe(true);

    await page.keyboard.press("Control+K");
    await expect(palette).toBeVisible();
    await page.getByRole("option", { name: "Focus message box" }).click();
    await expect(palette).toBeHidden();
    await expect(page.locator("textarea").first()).toBeFocused();
    await expect
      .poll(() => openerHandle!.evaluate((element) => element === document.activeElement))
      .toBe(false);
  });
});
