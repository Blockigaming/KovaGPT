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
    await expect(page.locator(".kova-topbar:visible")).toHaveCount(1);
    const close = surface.getByRole("button", { name: "Close settings", exact: true });
    await expect(close).toBeVisible();
    const phonePalette = await page.evaluate(
      () =>
        matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
          .matches,
    );
    const composerBackground = phonePalette
      ? theme === "dark"
        ? "rgb(42, 42, 42)"
        : "rgb(239, 239, 239)"
      : theme === "dark"
        ? "rgb(48, 48, 48)"
        : "rgb(255, 255, 255)";
    await expect(surface).toHaveCSS("background-color", composerBackground);
    await expect(page.locator('[data-slot="dialog-overlay"]')).toBeVisible();
    await expect(
      surface.getByRole("heading", { name: "Personalization", exact: true }),
    ).toBeVisible();
    await expect(surface.locator(".kova-settings-page-header")).toHaveCount(0);
    const top = (await surface.boundingBox())!.y;
    const header = surface.locator(".kova-settings-content-header");
    await expect(header).toHaveCSS("background-color", composerBackground);
    expect((await header.boundingBox())!.y - top).toBeLessThanOrEqual(1);
    const phone = await usesCompactSettings(page);
    if (!phone) {
      const navigation = surface.getByRole("complementary", { name: "Settings navigation" });
      await expect(navigation).toHaveCSS("background-color", composerBackground);
      await expect(surface.getByRole("textbox", { name: "Search settings" })).toHaveCSS(
        "background-color",
        composerBackground,
      );
      expect((await navigation.boundingBox())!.y - top).toBeLessThanOrEqual(1);
      await expect(surface.locator(".kova-settings-navigation-heading h2")).toBeVisible();
      expect(
        await surface.locator(".kova-settings-main-title").evaluate((node) => {
          const style = getComputedStyle(node.closest(".sr-only")!);
          return { position: style.position, clipPath: style.clipPath };
        }),
      ).toEqual({ position: "absolute", clipPath: "inset(50%)" });
    } else {
      await surface.getByRole("button", { name: "Back to settings", exact: true }).click();
      await expect(close).toBeVisible();
      await expect(surface.locator(".kova-settings-navigation-heading h2")).toBeVisible();
      expect(
        await surface.locator(".kova-settings-main-title").evaluate((node) => {
          const style = getComputedStyle(node.closest(".sr-only")!);
          return { position: style.position, clipPath: style.clipPath };
        }),
      ).toEqual({ position: "absolute", clipPath: "inset(50%)" });
    }
    await surface.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(surface.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(surface.locator(".kova-appearance-size")).toHaveCSS(
      "background-color",
      composerBackground,
    );
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

test("a second tab can send while the first tab stays open", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900");
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.locks.query()).held?.some((lock) =>
          lock.name.startsWith("kova-chat-history:"),
        ),
      ),
    )
    .toBe(true);

  const second = await page.context().newPage();
  await fixture(second, "dark", true);
  let requests = 0;
  await second.route("**/api/chat", (route) => {
    requests += 1;
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Reply from the second tab."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await second.goto("/");
  await waitForKovaHydration(second);
  const workspaceColor = await second
    .locator(".kova-chat-main")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(second.locator(".kova-composer-tray")).toHaveCSS("background-color", workspaceColor);
  await second.getByRole("textbox", { name: "Message KovaGPT" }).fill("Send from the second tab");
  await second.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(second.getByText("Reply from the second tab.", { exact: true })).toBeVisible();
  expect(page.isClosed()).toBe(false);
  expect(requests).toBe(1);
});
