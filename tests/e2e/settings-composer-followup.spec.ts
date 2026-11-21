import { usesCompactSettings } from "./settings-layout-fixture";
import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { closeCurrentSettings, openResponseOptions } from "./current-ui";

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: Settings has full-height navigation and one visible title`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true);
    await page.goto("/settings/memory");
    await waitForKovaHydration(page);
    const surface = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(surface).toBeVisible();
    await expect(page.locator(".kova-settings-page")).toHaveCount(0);
    const close = surface.getByRole("button", { name: "Close settings", exact: true });
    await expect(close).toBeVisible();
    const heading = surface.getByRole("heading", { name: "Personalization", exact: true });
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeInViewport({ ratio: 1 });
    const navigation = surface.getByRole("complementary", { name: "Settings navigation" });
    if (!(await usesCompactSettings(page))) {
      await expect(navigation).toBeVisible();
      const panelBox = (await surface.boundingBox())!;
      const navBox = (await navigation.boundingBox())!;
      expect(navBox.height).toBeGreaterThanOrEqual(panelBox.height - 4);
      await expect(navigation.getByRole("heading", { name: "Settings", exact: true })).toHaveCount(
        1,
      );
    } else {
      await expect(navigation).toBeHidden();
      await surface.getByRole("button", { name: "Back to settings", exact: true }).click();
      await expect(close).toBeVisible();
      await expect(
        navigation.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeInViewport({ ratio: 1 });
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

test("a started chat hides its resource tray and keeps preferences available in Settings", async ({
  page,
}) => {
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();
  await expect(page.locator(".kova-composer-tray")).toBeHidden();
  const options = await openResponseOptions(page);
  await expect(options).toBeVisible();
  await closeCurrentSettings(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeEnabled();
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
  await expect(dictation.locator(".kova-inline-dictation-wave i")).toHaveCount(72);
  await expect(dictation.getByRole("button", { name: "Stop and transcribe" })).toBeVisible();
  await expect(dictation.getByRole("button", { name: "Add transcript to chat" })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const composer = document.querySelector(".spec400-composer")!;
        const recorder = document.querySelector(".kova-inline-dictation")!;
        return (
          getComputedStyle(composer).backgroundColor === getComputedStyle(recorder).backgroundColor
        );
      }),
    )
    .toBe(true);
  await expect(page.locator(".spec400-composer")).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("inline-dictation.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dictation).toHaveCount(0);
  await expect(input).toHaveValue("Keep my typed draft");
  await expect(trigger).toBeFocused();
});
