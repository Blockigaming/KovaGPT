import { expect, test, type Locator } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { openResponseOptions } from "./current-ui";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: modern workspace surfaces remain usable and contained`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await coreFixture(page, theme);
    for (const path of [
      "/projects",
      "/library",
      "/apps",
      "/scheduled-tasks",
      "/settings/appearance",
      "/settings/profile",
      "/pricing",
      "/help",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      const main = page.getByRole("main");
      await expect(main).toHaveCount(1);
      await expect(main).toBeVisible();
      if (path === "/apps") {
        await expect(page.locator(".spec400-plugin-card h2").first()).toHaveCSS(
          "font-size",
          "16px",
        );
        const radius = await page
          .locator(".spec400-plugin-tabs")
          .evaluate((el) => parseFloat(getComputedStyle(el).borderRadius));
        expect(radius).toBeGreaterThanOrEqual(12);
      }
      if (path === "/library") {
        await expect(
          page.getByText("Modified unavailable in this list", { exact: false }),
        ).toHaveCount(0);
      }
      if (path === "/pricing") {
        const terms = page.getByText(/Cancellation, rejoining/);
        await expect(terms).toBeHidden();
        const summary = page
          .locator("summary")
          .filter({ hasText: "Offer details and eligibility" });
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(terms).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(terms).toBeHidden();
      }

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        path,
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath(`${path.replaceAll("/", "-")}-${theme}.png`),
        animations: "disabled",
      });
    }
  });
}

test("menus retain focus, placement, and reduced-motion behavior", async ({ page }, info) => {
  await coreFixture(page, "dark");
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeEnabled();
  const attach = page.locator('button[aria-label="Attach"]');
  let optionsTrigger: Locator | undefined;
  const rememberTrigger = (trigger: Locator) => {
    optionsTrigger = trigger;
  };
  const panel = await openResponseOptions(page, rememberTrigger);
  expect(optionsTrigger).toBeDefined();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({ path: info.outputPath("options-menu-dark.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(optionsTrigger!).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openResponseOptions(page, rememberTrigger);
  await expect(panel).toBeVisible();
  const motion = await panel.evaluate((el) => ({
    duration: getComputedStyle(el).animationDuration,
    name: getComputedStyle(el).animationName,
  }));
  expect(
    motion.name === "none" || motion.duration.split(",").every((x) => parseFloat(x) <= 0.01),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(optionsTrigger!).toBeFocused();
  await attach.click();
  await expect(attach).toHaveAttribute("aria-expanded", "true");
  const attachmentPanel = page.getByRole("dialog").filter({ visible: true });
  await expect(attachmentPanel).toHaveCount(1);
  const attachmentBox = await attachmentPanel.boundingBox();
  expect(attachmentBox!.x).toBeGreaterThanOrEqual(0);
  expect(attachmentBox!.x + attachmentBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  await page.keyboard.press("Escape");
  await expect(attach).toHaveAttribute("aria-expanded", "false");
  await expect(attach).toBeFocused();
});
