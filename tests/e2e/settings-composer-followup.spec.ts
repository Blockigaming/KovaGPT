import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { openResponseOptions } from "./current-ui";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: Settings has full-height navigation and one visible title`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true);
    await page.goto("/settings/memory");
    await waitForKovaHydration(page);
    const surface = page.locator("section.kova-settings-page");
    const close = surface.getByRole("button", { name: "Close settings", exact: true });
    await expect(close).toBeVisible();
    await expect(surface.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
    await expect(surface.locator(".kova-settings-page-header")).toHaveCount(0);
    const top = (await surface.boundingBox())!.y;
    const header = surface.locator(".kova-settings-content-header");
    expect((await header.boundingBox())!.y - top).toBeLessThanOrEqual(1);
    if (page.viewportSize()!.width >= 768) {
      const navigation = surface.getByRole("complementary", { name: "Settings navigation" });
      expect((await navigation.boundingBox())!.y - top).toBeLessThanOrEqual(1);
      await expect(surface.locator(".kova-settings-navigation-heading h2")).toBeVisible();
      expect(
        await surface.locator("h1").evaluate((node) => {
          const style = getComputedStyle(node.closest(".sr-only")!);
          return { position: style.position, clipPath: style.clipPath };
        }),
      ).toEqual({ position: "absolute", clipPath: "inset(50%)" });
    } else {
      await surface.getByRole("button", { name: "Back to settings", exact: true }).click();
      await expect(surface.locator(".kova-settings-navigation-heading h2")).toBeVisible();
      expect(
        await surface.locator("h1").evaluate((node) => {
          const style = getComputedStyle(node.closest(".sr-only")!);
          return { position: style.position, clipPath: style.clipPath };
        }),
      ).toEqual({ position: "absolute", clipPath: "inset(50%)" });
      await surface.getByRole("tab", { name: "Appearance", exact: true }).click();
      await expect(surface.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`settings-${theme}.png`),
      animations: "disabled",
    });
    await close.click();
    await expect(surface).toHaveCount(0);
  });
}

test("a started chat hides its resource tray and keeps preferences available through Attach", async ({
  page,
}) => {
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();
  await expect(page.locator(".kova-composer-tray")).toBeHidden();
  const options = await openResponseOptions(page);
  await expect(options).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeFocused();
});

test("Type with voice replaces the composer inline and Escape preserves the draft", async ({
  page,
}, info) => {
  await fixture(page, "dark", true);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => ({ getTracks: () => [{ stop() {} }] }),
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
        state = "inactive";
        mimeType = "audio/webm";
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
        }
      },
    });
  });
  await page.route("**/api/voice", (route) =>
    route.fulfill({
      json: {
        configured: true,
        stt: true,
        tts: false,
        sts: false,
        conversation: false,
        voices: [],
        defaultVoiceId: null,
      },
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Keep my typed draft");
  const trigger = page.getByRole("button", { name: "Type with voice", exact: true });
  await trigger.click();
  const dictation = page.getByRole("region", { name: "Type with voice", exact: true });
  await expect(dictation).toHaveAttribute("data-voice-phase", "recording");
  await expect(page.locator(".spec400-composer")).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("inline-dictation.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dictation).toHaveCount(0);
  await expect(input).toHaveValue("Keep my typed draft");
  await expect(trigger).toBeFocused();
});
