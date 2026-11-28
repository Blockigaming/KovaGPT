import { test, expect } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

test("Free chat offers Default and Thinking without executing Chat", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "free" });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const thinking = page.getByRole("button", { name: "Thinking", exact: true });
  await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
  await expect(page.getByTestId("consumer-model-trigger")).toHaveCount(0);
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  await expect(thinking).toHaveAttribute("title", "Kova Argon 4.6 Lite");
  const mobile = await page.evaluate(() => matchMedia("(width < 768px)").matches);
  const restingBounds = await thinking.boundingBox();
  if (mobile) {
    const greeting = page.locator(".kova-empty-chat-content .kova-greeting");
    await expect(greeting).toHaveCSS("position", "fixed");
    const offset = await greeting.evaluate(
      (el) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2,
    );
    const viewportMiddle = await page.evaluate(() => window.innerHeight / 2);
    expect(Math.abs(offset - (viewportMiddle - 8))).toBeLessThanOrEqual(3);
  }
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "true");
  await expect(thinking).toHaveAttribute("title", "Kova Argon 4.6 Medium");
  await expect(thinking).toHaveCSS("color", "rgb(59, 130, 246)");
  await expect(thinking.locator("svg")).toHaveCSS("color", "rgb(59, 130, 246)");
  if (mobile && (await page.evaluate(() => matchMedia("(forced-colors: none)").matches))) {
    await expect(thinking).toHaveCSS("padding-inline-start", "6px");
    await expect(thinking).toHaveCSS("padding-inline-end", "12px");
    const pill = await thinking.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return { top: style.top, bottom: style.bottom, content: style.content };
    });
    expect(pill.top).toBe("3px");
    expect(pill.bottom).toBe("3px");
    expect(pill.content).toBe('""');
    const selectedBounds = await thinking.boundingBox();
    expect(selectedBounds!.height).toBe(restingBounds!.height);
    expect(selectedBounds!.width).toBe(restingBounds!.width);
  }
  await thinking.click();
  await expect(thinking).toHaveAttribute("aria-pressed", "false");
  expect(chatRequests).toBe(0);
});

test("Plus picker exposes Lite through Max and supports touch dragging", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "plus" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const trigger = page.getByTestId("model-selector-trigger");
  await expect(trigger).toBeVisible();
  await expect(page.getByTestId("consumer-model-trigger")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thinking", exact: true })).toHaveCount(0);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const picker = page.getByRole("dialog", { name: "Select model", exact: true });
  const slider = picker.getByRole("slider", { name: "Response effort", exact: true });
  const thumb = picker.locator('[data-slot="effort-thumb"]');
  const options = picker.getByRole("group", { name: "Available models" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Select model", exact: true }).click();
  await expect(options.getByRole("button").first()).toHaveAccessibleName(/^Default Recommended/);
  await expect(options.getByRole("button")).toHaveCount(8);
  await picker.getByRole("button", { name: "Back to response effort" }).click();
  await expect(picker.locator(".kova-effort-icon")).toHaveCount(0);
  await expect(slider).toHaveAttribute("max", "4");
  await expect(slider).toHaveAttribute("aria-valuetext", "Lite");

  const isTouchPhone = await page.evaluate(
    () => matchMedia("(max-width: 767px) and (pointer: coarse)").matches,
  );
  if (isTouchPhone) {
    // Phones dock the popup above the chat bar at the chat bar's width.
    const composerWidth = await page
      .locator(".spec400-composer:visible")
      .first()
      .evaluate((el) => `${el.getBoundingClientRect().width}px`);
    await expect(picker).toHaveCSS("width", composerWidth);
    await expect(picker).toBeInViewport({ ratio: 1 });
    const bounds = (await picker.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(360);
    expect(bounds.height).toBeGreaterThan(95);
    const rail = (await slider.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    const y = Math.round(rail.y + rail.height / 2);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: Math.round(rail.x + 14), y }],
    });
    const betweenStops = Math.round(rail.x + rail.width * 0.37);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: betweenStops, y }],
    });
    await expect
      .poll(async () => {
        const bounds = (await thumb.boundingBox())!;
        return Math.abs(bounds.x + bounds.width / 2 - betweenStops);
      })
      .toBeLessThan(2);
    for (const fraction of [0.25, 0.5, 0.75, 0.95]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: Math.round(rail.x + rail.width * fraction), y }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await expect(slider).toHaveAttribute("aria-valuetext", "Max");
  }

  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "Medium");
  await expect(trigger).toContainText("Medium");
  await slider.press("End");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "Max");
  await slider.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("Pro picker combines all models, Ultra and the recommended default", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "pro" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("button", { name: "Thinking", exact: true })).toHaveCount(0);

  const trigger = page.getByTestId("model-selector-trigger");
  const picker = page.getByRole("dialog", { name: "Select model", exact: true });
  const slider = picker.getByRole("slider", { name: "Response effort", exact: true });
  const recommended = picker.getByRole("button", { name: /^Default Recommended/ });
  await trigger.click();
  await picker.getByRole("button", { name: "Select model", exact: true }).click();
  await expect(recommended).toHaveAttribute("aria-pressed", "true");
  await expect(picker.locator('[data-testid^="consumer-model-kova-"]')).toHaveCount(7);
  await picker.getByRole("button", { name: "Back to response effort" }).click();
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "High");
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Ultra");

  await expect(trigger).toContainText("Kova Xenon 6.1 Ultra");
  await picker.getByRole("button", { name: "Select model", exact: true }).click();
  const xenon = picker.getByTestId("consumer-model-kova-xenon-5");
  await xenon.click();
  await expect(slider).toBeVisible();
  await expect(trigger).toHaveAttribute(
    "aria-label",
    "Choose model and effort, Kova Xenon 5 Ultra",
  );
  await picker.getByRole("button", { name: "Select model", exact: true }).click();
  await expect(xenon).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Reset to recommended model and Lite effort" }).click();
  await expect(xenon).toHaveCount(0);
  await expect(slider).toHaveAttribute("aria-valuetext", "Lite");
  await expect(trigger).toHaveAttribute(
    "aria-label",
    "Choose model and effort, Kova Argon 4.6 Lite",
  );
  await expect(trigger).toHaveText("Kova Argon 4.6 Lite");
});

test("the full current model fits beside or above the speech controls", async ({ page }) => {
  await installAuthenticatedFixture(page, { tier: "pro" });
  await page.goto("/");
  await waitForKovaHydration(page);
  const composer = page.locator('[data-composer-surface="empty"] .spec400-composer');
  const trigger = composer.getByTestId("model-selector-trigger");
  await trigger.click();
  const slider = page.getByRole("slider", { name: "Response effort" });
  for (let step = 0; step < 3; step++) await slider.press("ArrowRight");
  await page.getByRole("button", { name: "Select model", exact: true }).click();
  await page.getByTestId("consumer-model-kova-xenon-6.1").click();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveText("Kova Xenon 6.1 Extra High");
  await expect(trigger).toHaveAttribute("title", "Kova Xenon 6.1 Extra High");
  await composer.getByRole("textbox", { name: "Message KovaGPT" }).fill("Keep this draft.");
  await expect(composer.getByTestId("send-button")).toBeInViewport({ ratio: 1 });
  const fits = await trigger.evaluate((button) => {
    const frame = button.closest(".spec400-composer")!;
    const mic = frame.querySelector('[data-testid="dictate-button"]')!.getBoundingClientRect();
    const model = button.getBoundingClientRect();
    const pill = button.querySelector<HTMLElement>(".kova-consumer-model-pill")!;
    const text = document.createRange();
    text.selectNodeContents(pill.firstElementChild!);
    const painted = pill.getBoundingClientRect();
    return (
      (model.right + 7.5 <= mic.left || model.bottom + 7.5 <= mic.top) &&
      painted.height < model.height &&
      Array.from(text.getClientRects()).every(
        (r) => r.left >= painted.left && r.right <= painted.right,
      )
    );
  });
  expect(fits).toBe(true);
});

test("signed-out visitors must log in before chat or model access", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("https://*.supabase.co/**", (route) => route.abort("blockedbyclient"));
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with email", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account", exact: true })).toBeVisible();
});

test.describe("short desktop model picker", () => {
  test.use({ viewport: { width: 1440, height: 520 }, isMobile: false, hasTouch: false });

  test("paid model picker fits a short window and preserves keyboard focus", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await installAuthenticatedFixture(page, { tier: "pro" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const trigger = page.getByTestId("model-selector-trigger");
    const picker = page.getByRole("dialog", { name: "Select model", exact: true });
    const models = picker.getByRole("button", { name: "Select model", exact: true });
    const reset = picker.getByRole("button", {
      name: "Reset to recommended model and Lite effort",
    });
    const slider = picker.getByRole("slider", { name: "Response effort", exact: true });
    const thumb = picker.locator('[data-slot="effort-thumb"]');
    await trigger.press("Space");
    await expect(picker).toBeVisible();
    // Phones dock the popup above the chat bar at its width; wider windows keep 282px.
    const expectedWidth = await page.evaluate(() => {
      if (window.innerWidth >= 768) return "282px";
      const composer = Array.from(document.querySelectorAll(".spec400-composer")).find(
        (el) => el.getClientRects().length > 0,
      );
      return `${composer?.getBoundingClientRect().width}px`;
    });
    await expect(picker).toHaveCSS("width", expectedWidth);
    await expect(picker).toBeInViewport({ ratio: 1 });
    await expect
      .poll(async () => {
        const button = (await trigger.boundingBox())!;
        const menu = (await picker.boundingBox())!;
        const verticalGap = Math.max(
          menu.y - (button.y + button.height),
          button.y - (menu.y + menu.height),
        );
        return Math.max(
          Math.abs(button.x + button.width - (menu.x + menu.width)),
          Math.abs(verticalGap),
        );
      })
      .toBeLessThan(10);
    await expect(models).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reset).toBeFocused();
    await expect(thumb).toHaveCSS("transition-property", "left");
    await expect(thumb).toHaveCSS("transition-duration", "0.18s");

    await expect(picker.locator('[data-slot="effort-track"]')).toHaveCSS("height", "24px");
    const ticks = picker.locator('[data-slot="effort-tick"]');
    await expect(ticks).toHaveCount(6);
    await expect(ticks.first()).toHaveCSS("width", "4px");

    const rail = (await slider.boundingBox())!;
    await slider.click({ position: { x: rail.width - 3, y: rail.height / 2 } });
    await expect(slider).toHaveAttribute("aria-valuetext", "Ultra");
    const fill = picker.locator('[data-slot="effort-fill"]');
    await expect
      .poll(() => fill.evaluate((el) => parseFloat(getComputedStyle(el, "::before").width)))
      .toBeGreaterThan(rail.width / 2);
    expect(await fill.evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).toBe(
      "rgb(77, 130, 238)",
    );
    await expect(ticks.last()).toHaveAttribute("data-filled", "true");
    await reset.click();
    await expect(slider).toHaveAttribute("aria-valuetext", "Lite");
    await expect(ticks.last()).toHaveAttribute("data-filled", "false");
    await slider.press("End");

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await expect(picker).toBeVisible();
    await expect(models).toBeFocused();
    await reset.press("Enter");
    await expect(slider).toHaveAttribute("aria-valuetext", "Lite");
  });
});
