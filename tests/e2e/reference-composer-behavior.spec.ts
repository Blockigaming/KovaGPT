import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { expectsSeparateModeRow } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the composer expands and contracts without a resize loop`, async ({
    page,
  }, info) => {
    const resizeErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (/ResizeObserver loop/i.test(error.message)) resizeErrors.push(error.message);
    });
    await fixture(page, theme, true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const composer = page.locator(".spec400-composer");
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const voice = page.getByTestId("voice-button");
    const send = page.getByTestId("send-button");
    await expect(input).toBeEnabled();
    await expect(voice).toBeVisible();
    await expect(send).toBeHidden();
    const desktop =
      page.viewportSize()!.width >= 1024 &&
      !(await page.evaluate(
        () => matchMedia("(width < 1024px) and (any-pointer: coarse)").matches,
      ));
    await expect(composer).toHaveCSS("display", "flex");
    const compactHeight = (await composer.boundingBox())!.height;
    // The compact phone frame applies in the native app shell and on phone-width web.
    const phone = await page.evaluate(() =>
      document.documentElement.dataset.kovaSurface === "app"
        ? matchMedia(
            "(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)",
          ).matches
        : matchMedia("(width < 768px)").matches,
    );
    expect(compactHeight).toBeGreaterThanOrEqual(phone ? 88 : 128);
    if (phone) {
      const stacked = await expectsSeparateModeRow(composer);
      expect(compactHeight).toBe(stacked ? 148 : 96);
    }

    // This text fits the full expanded row but wraps the narrow desktop slot.
    // A height-based toggle would alternate between those two layouts forever.
    await input.fill("expand ".repeat(36));
    await expect(send).toBeVisible();
    await expect(voice).toBeHidden();
    if (desktop) {
      await expect(input).toHaveAttribute("data-multiline", "true");
      await expect(composer).toHaveCSS("display", "flex");
    }
    const heights = await composer.evaluate(async (node) => {
      const values: number[] = [];
      for (let frame = 0; frame < 8; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(node.getBoundingClientRect().height);
      }
      return values;
    });
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(resizeErrors).toEqual([]);

    await input.fill("");
    await expect(voice).toBeVisible();
    await expect(send).toBeHidden();
    await expect(input).toBeFocused();
    await expect.poll(async () => (await composer.boundingBox())!.height).toBe(compactHeight);
    await page.screenshot({
      path: info.outputPath(`reference-composer-${theme}.png`),
      animations: "disabled",
    });
  });
}

test("the primary Voice action restores focus and typing changes only the primary action", async ({
  page,
}) => {
  await fixture(page, "dark", true, true);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        document.documentElement.dataset.unexpectedMicrophoneRequest = "true";
        return Promise.reject(new Error("This fixture never permits microphone capture"));
      },
    });
  });
  let chatRequests = 0;
  await page.route("**/api/chat", (route) => {
    chatRequests++;
    return route.fulfill({ status: 503, json: { error: "No provider is used by this fixture" } });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const voice = page.getByTestId("voice-button");
  const send = page.getByTestId("send-button");
  await expect(voice).toBeVisible();
  await expect(voice).toBeEnabled();
  await voice.click();
  const inlineVoice = page.locator("#kova-inline-voice");
  await expect(inlineVoice).toBeVisible();
  await expect(voice).toHaveAccessibleName("Stop voice");
  await expect(voice).toHaveAttribute("aria-expanded", "true");
  await expect(voice).toHaveAttribute("aria-controls", "kova-inline-voice");
  await voice.focus();
  await page.keyboard.press("Enter");
  await expect(inlineVoice).toBeHidden();
  await expect(voice).toHaveAccessibleName("Voice");
  await expect(voice).toHaveAttribute("aria-expanded", "false");
  await expect(voice).toBeFocused();

  await input.fill("Keep this editable draft");
  await expect(send).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(voice).toBeHidden();
  await expect(input).toBeFocused();
  await input.fill("");
  await expect(voice).toBeVisible();
  await expect(send).toBeHidden();
  await expect(input).toBeFocused();
  await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-microphone-request");
  expect(chatRequests).toBe(0);
});
