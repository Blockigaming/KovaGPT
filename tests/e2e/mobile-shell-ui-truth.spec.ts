import { expect, test } from "@playwright/test";

function isPhoneOrDesktop(width: number) {
  return width < 768 || width >= 1280;
}

test.describe("mobile shell UI truth", () => {
  test("the phone drawer fills the viewport and restores focus", async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 768, "phone-only drawer contract");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: "Open menu" });
    await opener.focus();
    await opener.click();

    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThanOrEqual(1);
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(box!.height).toBeGreaterThanOrEqual(viewport!.height - 1);

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
    const viewport = page.viewportSize();
    test.skip(!viewport || !isPhoneOrDesktop(viewport.width), "phone and desktop contract");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const opener =
      viewport!.width < 768
        ? page.getByRole("button", { name: "Open menu" })
        : page.locator('[data-testid="model-selector-trigger"]:visible').first();
    await opener.focus();
    await page.keyboard.press("Control+K");

    const palette = page.getByRole("dialog", { name: "Search chats and actions" });
    await expect(palette).toBeVisible();
    const paletteBox = await palette.boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
    expect(paletteBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);

    const close = page.getByRole("button", { name: "Close command palette" });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);

    const panel = palette.locator(":scope > div").first();
    const animationDuration = await panel.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).animationDuration) || 0,
    );
    expect(animationDuration).toBeLessThanOrEqual(0.001);

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
