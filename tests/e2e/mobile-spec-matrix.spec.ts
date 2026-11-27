import { expect, test } from "@playwright/test";
import { readableTextColor } from "../../src/lib/appearance-preferences.mjs";
import { fixture } from "./actual-app-fixture";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

const viewports = [
  [320, 568],
  [360, 800],
  [375, 667],
  [390, 844],
  [402, 874],
  [430, 932],
  [480, 960],
  [600, 960],
  [667, 375],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
] as const;

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900", "this spec sets its own viewport");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const typographyCases = [
  ...viewports.map(([width, height]) => ({ width, height, textSize: 20 })),
  { width: 320, height: 568, textSize: 32 },
];

for (const { width, height, textSize } of typographyCases) {
  for (const theme of ["light", "dark"] as const) {
    test(`chat fits ${width}×${height} in ${theme} with ${textSize}px native text`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await fixture(page, theme);
      await page.setViewportSize({ width, height });
      await page.route("**/mobile-spec-image.png", (route) =>
        route.fulfill({
          contentType: "image/png",
          path: "public/kova-logo.png",
        }),
      );
      const imageUrl = new URL("/mobile-spec-image.png", test.info().project.use.baseURL).href;
      const content = [
        "## Responsive report",
        "AnUnbrokenToken".repeat(30),
        "The prices are $10 and $25. Inline math: $$x^2$$.",
        "",
        "| Category | Measurement |",
        "| --- | --- |",
        "| One | " + "x".repeat(90) + " |",
        "",
        `![Responsive preview](${imageUrl})`,
        "",
        "```text",
        "long_code_".repeat(40),
        "```",
        "",
        "$$",
        "a + " + "\\frac{x^2 + y^2}{x + y} + ".repeat(16) + "z",
        "$$",
        "",
        "```kova-chart",
        JSON.stringify({
          title: "Measurements",
          type: "bar",
          data: [{ name: "A very long axis label", value: 4 }],
        }),
        "```",
        "",
        ...Array.from(
          { length: 18 },
          (_, index) =>
            `Paragraph ${index + 1}. This longer response checks scrolling while the message composer stays reachable.`,
        ),
      ].join("\n");
      let releaseReply!: () => void;
      const replyReady = new Promise<void>((resolve) => {
        releaseReply = resolve;
      });
      await page.route("**/api/chat", async (route) => {
        await replyReady;
        await route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        });
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);

      const html = page.locator("html");
      await html.evaluate(
        (element, { theme, textSize }) => {
          element.classList.toggle("dark", theme === "dark");
          element.style.setProperty("--kova-native-font-size", `${textSize}px`);
        },
        { theme, textSize },
      );

      if (width < 768) {
        const palette = await html.evaluate((element) => {
          const styles = getComputedStyle(element);
          return ["--background", "--sidebar", "--composer-background"].map((token) =>
            styles
              .getPropertyValue(token)
              .trim()
              .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3"),
          );
        });
        expect(palette).toEqual(
          theme === "dark" ? ["#111111", "#171717", "#2a2a2a"] : ["#ffffff", "#f7f7f8", "#efefef"],
        );
      }

      if (width === 320 && textSize === 20) {
        const colors = await html.evaluate((element) => {
          const styles = getComputedStyle(element);
          return Object.fromEntries(
            [
              "--composer-background",
              "--kova-phone-placeholder",
              "--destructive",
              "--destructive-foreground",
              "--kova-phone-danger-text",
              "--sidebar-active",
            ].map((token) => [
              token,
              styles
                .getPropertyValue(token)
                .trim()
                .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3"),
            ]),
          );
        });
        for (const [surface, ink] of [
          ["--composer-background", "--kova-phone-placeholder"],
          ["--destructive", "--destructive-foreground"],
          ["--kova-phone-danger-text", "--destructive-foreground"],
          ["--sidebar-active", "--kova-phone-danger-text"],
        ]) {
          expect(colors[surface]).toMatch(/^#[0-9a-f]{6}$/i);
          expect(colors[ink]).toMatch(/^#[0-9a-f]{6}$/i);
          expect(readableTextColor(colors[surface], colors[ink]), ink).toBe(colors[ink]);
        }
      }

      const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
      await expect(composer).toBeVisible();
      if (width < 768) {
        await expect(composer).toHaveCSS("font-size", `${textSize}px`);
        await expect(composer).toHaveCSS("line-height", `${textSize * 1.5}px`);
        await expect(composer).toHaveCSS("unicode-bidi", "plaintext");
      }
      await composer.fill("First line\nA second line for this draft.");
      const send = page.getByRole("button", { name: "Send message" });
      await send.scrollIntoViewIfNeeded();
      await expect(send).toBeInViewport({ ratio: 1 });

      if (width < 1024) {
        await page.getByRole("button", { name: "Open menu" }).click();
        const drawer = page.getByRole("dialog", { name: "Primary navigation" });
        await expect(drawer).toBeVisible();
        await drawer.getByRole("button", { name: "Close sidebar", exact: true }).click();
        await expect(drawer).toBeHidden();
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
      }

      await page.getByRole("button", { name: "Attach", exact: true }).click();
      const attachmentOptions = page.getByRole("dialog", { name: "Attach files and tools" });
      if (width < 1024) await expect(attachmentOptions).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(attachmentOptions).toBeHidden();

      if (width < 768 && height > width) {
        await page.setViewportSize({ width: height, height: width });
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
        await page.setViewportSize({ width, height });
        await expect(composer).toHaveValue("First line\nA second line for this draft.");
      }

      try {
        await send.click();
        const stop = page.getByRole("button", { name: "Stop generating" });
        await expect(stop).toBeInViewport({ ratio: 1 });
      } finally {
        releaseReply();
      }
      await expect(page.getByRole("heading", { name: "Responsive report" })).toBeAttached({
        timeout: 15_000,
      });
      await expect(page.getByText("The prices are $10 and $25.", { exact: false })).toBeAttached();
      const equation = page.getByRole("group", { name: "Equation" });
      await expect(equation.locator("math")).toBeAttached();
      const overflow = await equation.evaluate((element) => ({
        scroll: element.scrollWidth - element.clientWidth,
        mode: getComputedStyle(element).overflowX,
      }));
      expect(overflow.scroll).toBeGreaterThan(0);
      expect(overflow.mode).toBe("auto");
      const transcript = page.locator("[data-chat-transcript]");
      await expect
        .poll(() => transcript.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(0);

      const header = page.locator(
        width < 1024
          ? ".kova-chat-main > .kova-topbar:not(.kova-desktop-topbar)"
          : ".kova-desktop-topbar",
      );
      const heights = await header.evaluate((element) => {
        const root = element.ownerDocument.documentElement;
        const before = element.getBoundingClientRect().height;
        root.classList.toggle("dark");
        const after = element.getBoundingClientRect().height;
        root.classList.toggle("dark");
        return { before, after };
      });
      expect(heights.before).toBeGreaterThan(0);
      expect(heights.after).toBe(heights.before);

      const chart = page.getByRole("figure", { name: "Interactive chart: Measurements" });
      const legend = chart.getByRole("list", { name: "Chart legend" });
      await expect(legend).toContainText("value", { timeout: 10_000 });
      const legendPosition = () =>
        legend.evaluate((element) => {
          const layout = element.parentElement!;
          const chartArea = layout.firstElementChild!;
          const legendBounds = element.getBoundingClientRect();
          const chartBounds = chartArea.getBoundingClientRect();
          return {
            beside: legendBounds.left >= chartBounds.right && legendBounds.top < chartBounds.bottom,
            wide: layout.getBoundingClientRect().width >= 600,
          };
        });
      await expect
        .poll(async () => {
          const position = await legendPosition();
          return position.beside === position.wide;
        })
        .toBe(true);
      await chart.getByRole("button", { name: "Table", exact: true }).click();
      await expect(chart.getByRole("table")).toBeVisible();

      const openImage = page.getByRole("button", { name: "View full size" });
      const preview = page.locator(".kova-response-image");
      const hoverDetail = preview.locator(".kova-image-hover-detail");
      await expect(hoverDetail).toBeHidden();
      if (width === 1440) {
        await preview.getByRole("button", { name: "Responsive preview", exact: true }).hover();
        await expect(hoverDetail).toBeVisible();
      }
      await openImage.click();
      const imageView = page.getByRole("dialog", { name: "Responsive preview" });
      const fullImage = imageView.getByRole("img", { name: "Responsive preview" });
      await expect(fullImage).toBeVisible();
      if (width === 1440) {
        await fullImage.click();
        await fullImage.press("Enter");
        await expect(page.getByRole("dialog")).toHaveCount(1);
      }
      const zoom = imageView.getByRole("button", { name: "Zoom image" });
      await zoom.click();
      await expect(zoom).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() =>
          imageView
            .getByRole("region", { name: "Image preview" })
            .evaluate((element) => element.scrollWidth - element.clientWidth),
        )
        .toBeGreaterThan(0);
      await zoom.click();
      await expect(zoom).toHaveAttribute("aria-pressed", "false");
      if (width < 768) {
        await expect.poll(async () => (await imageView.boundingBox())?.width).toBe(width);
      }
      await imageView.getByRole("button", { name: "Close", exact: true }).click();
      await expect(openImage).toBeFocused();

      expect(await html.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    });
  }
}

for (const [width, height] of viewports) {
  test(`long model names leave the composer usable at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installAuthenticatedFixture(page, { tier: "plus" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    const composer = page.locator(".spec400-composer");
    const model = composer.getByTestId("model-selector-trigger");
    await expect(model).toBeVisible();
    await composer.getByRole("textbox", { name: "Message KovaGPT" }).fill("Draft");
    await model.locator(".kova-consumer-model-pill > span").evaluate((label) => {
      label.textContent = "Kova long model label for narrow viewports ".repeat(5);
    });
    await expect(composer.getByRole("button", { name: "Send message" })).toBeInViewport();
    const bounds = await model.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  });
}

test("tabletop posture keeps the composer above the hinge and preserves the draft as it unfolds", async ({
  page,
}) => {
  await fixture(page, "dark");
  const session = await page.context().newCDPSession(page);
  const screen = {
    width: 700,
    height: 900,
    screenWidth: 700,
    screenHeight: 900,
    deviceScaleFactor: 2,
    mobile: true,
  };
  await session.send("Emulation.setDeviceMetricsOverride", {
    ...screen,
    displayFeature: { orientation: "horizontal", offset: 440, maskLength: 20 },
    devicePosture: { type: "folded" },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await composer.fill("Keep this draft when the screen unfolds");
  const bounds = await composer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(440);

  await session.send("Emulation.setDeviceMetricsOverride", {
    ...screen,
    devicePosture: { type: "continuous" },
  });
  await expect
    .poll(() => page.evaluate(() => matchMedia("(vertical-viewport-segments: 2)").matches))
    .toBe(false);
  await expect(composer).toHaveValue("Keep this draft when the screen unfolds");
});

test("phone controls clear the safe areas as the available height changes", async ({ page }) => {
  await fixture(page, "dark");
  const session = await page.context().newCDPSession(page);
  const screen = {
    width: 390,
    screenWidth: 390,
    screenHeight: 844,
    deviceScaleFactor: 3,
    mobile: true,
  };
  await session.send("Emulation.setDeviceMetricsOverride", { ...screen, height: 844 });
  await session.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 44, right: 24, bottom: 34, left: 28 },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const shell = page.locator('.kova-assistant[data-ui="modern"]');
  const header = shell.locator(".kova-topbar:not(.kova-desktop-topbar) .kova-topbar-inner");
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await composer.fill("A draft that should stay in place");
  await composer.blur();
  const send = page.getByRole("button", { name: "Send message" });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#111111");

  for (const height of [844, 736, 844]) {
    await session.send("Emulation.setDeviceMetricsOverride", { ...screen, height });
    await expect(shell).toHaveCSS("height", `${height}px`);
    await expect.poll(async () => (await header.boundingBox())?.y).toBeGreaterThanOrEqual(44);
    await expect
      .poll(async () => {
        const bounds = await send.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(height - 34);
    const bounds = await composer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(28);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(screen.width - 24);
    await expect(composer).toHaveValue("A draft that should stay in place");
    await expect(shell).not.toHaveAttribute("data-keyboard-open", "true");
  }

  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(1.5);
  await expect(shell).not.toHaveAttribute("data-keyboard-open", "true");
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await session.send("Emulation.setDeviceMetricsOverride", {
    ...screen,
    width: 844,
    screenWidth: 844,
    height: 600,
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#191919");
  await session.send("Emulation.setDeviceMetricsOverride", { ...screen, height: 844 });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#111111");
  await expect(composer).toHaveValue("A draft that should stay in place");
});
