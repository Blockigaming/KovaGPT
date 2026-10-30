import { expect, test, type Locator, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";

// Decode the actual browser PNG, including row filters. This checks painted
// contrast independently of CSS declarations and without a host image library.
function bitmap(png: Buffer) {
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
      expect(data[12]).toBe(0);
    }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels,
    decoded = Buffer.alloc(stride * height);
  const paeth = (left: number, up: number, corner: number) => {
    const value = left + up - corner;
    const distances = [Math.abs(value - left), Math.abs(value - up), Math.abs(value - corner)];
    return distances[0] <= distances[1] && distances[0] <= distances[2]
      ? left
      : distances[1] <= distances[2]
        ? up
        : corner;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const up = y > 0 ? decoded[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, corner);
      decoded[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predicted) & 255;
    }
  }
  return {
    width,
    height,
    at: (x: number, y: number) =>
      Array.from(decoded.subarray((y * width + x) * channels, (y * width + x) * channels + 3)),
  };
}
async function settlePaintTranslation(control: Locator) {
  await control.evaluate(async (input: HTMLElement) => {
    // Reduced-motion CSS still gives native inputs a short transition. Flush
    // layout and await the actual translate transition before reading its box.
    input.getBoundingClientRect();
    await Promise.all(
      input
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === "translate",
        )
        .map((animation) => animation.finished),
    );
  });
}

// A locator screenshot rounds fractional layout edges outwards: an 18px
// control at y=100.5 can otherwise produce a 19px PNG. Align only the isolated
// fixture control's paint origin, preserving its exact DOM size and CSS glyph.
async function paintedControl(control: Locator, expectedSize: 16 | 18, path?: string) {
  await control.scrollIntoViewIfNeeded();
  const before = (await control.boundingBox())!;
  expect([before.width, before.height]).toEqual([expectedSize, expectedSize]);
  const original = await control.evaluate((input: HTMLElement) => {
    const original = {
      value: input.style.getPropertyValue("translate"),
      priority: input.style.getPropertyPriority("translate"),
    };
    const box = input.getBoundingClientRect();
    input.style.setProperty(
      "translate",
      `${Math.round(box.x) - box.x}px ${Math.round(box.y) - box.y}px`,
      "important",
    );
    return original;
  });
  try {
    await settlePaintTranslation(control);
    const aligned = (await control.boundingBox())!;
    expect([aligned.width, aligned.height]).toEqual([expectedSize, expectedSize]);
    expect([aligned.x, aligned.y]).toEqual([Math.round(aligned.x), Math.round(aligned.y)]);
    const pixels = bitmap(await control.screenshot({ path, scale: "css" }));
    expect([pixels.width, pixels.height]).toEqual([expectedSize, expectedSize]);
    return pixels;
  } finally {
    await control.evaluate((input: HTMLElement, original) => {
      if (original.value) input.style.setProperty("translate", original.value, original.priority);
      else input.style.removeProperty("translate");
    }, original);
    await settlePaintTranslation(control);
    const restored = (await control.boundingBox())!;
    expect(restored).toEqual(before);
  }
}

function luminance(rgb: number[]) {
  const values = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
async function open(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto("/?surface=native-controls");
  await page.evaluate(
    (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
    theme,
  );
  await expect(page.getByRole("heading", { name: "Native form controls" })).toBeVisible();
}

for (const pointer of ["fine", "coarse"] as const) {
  test.describe(`native controls with ${pointer} pointer`, () => {
    test.use({ hasTouch: pointer === "coarse" });
    for (const theme of ["light", "dark"] as const) {
      test(`${theme}: native Space, radio arrows and FormData preserve browser semantics`, async ({
        page,
        browserName,
      }) => {
        await open(page, theme);
        const checkbox = page.getByRole("checkbox", { name: "Include notes", exact: true });
        const list = page.getByRole("radio", { name: "List", exact: true });
        const grid = page.getByRole("radio", { name: "Grid", exact: true });
        const disabled = page.getByRole("checkbox", { name: "Disabled example", exact: true });
        const mixed = page.getByRole("checkbox", { name: "Mixed example", exact: true });
        const controlBox = (await checkbox.boundingBox())!;
        expect(
          [controlBox.width, controlBox.height],
          "Library-scoped native checkbox retains its canonical paint geometry",
        ).toEqual([18, 18]);
        await expect(checkbox).toHaveCSS("appearance", "none");
        await checkbox.focus();
        await checkbox.press("Space");
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeFocused();
        await expect(checkbox).toHaveCSS("outline-style", "solid");
        await expect(checkbox).toHaveCSS("outline-width", "2px");
        await list.focus();
        await list.press("ArrowRight");
        await expect(grid).toBeChecked();
        await expect(grid).toBeFocused();
        await grid.press("ArrowRight");
        const disabledView = page.getByRole("radio", { name: "Disabled view", exact: true });
        if (browserName === "webkit") {
          // WebKit's native group stops before the disabled final radio instead
          // of wrapping. Verify the boundary and both enabled directions.
          await expect(grid).toBeChecked();
          await expect(grid).toBeFocused();
          await grid.press("ArrowLeft");
          await expect(list).toBeChecked();
          await expect(list).toBeFocused();
          await list.press("ArrowRight");
        } else {
          await expect(list).toBeChecked();
          await expect(list).toBeFocused();
          await list.press("ArrowLeft");
        }
        await expect(grid).toBeChecked();
        await expect(grid).toBeFocused();
        await expect(list).not.toBeChecked();
        await expect(disabledView).toBeDisabled();
        await expect(disabledView).not.toBeChecked();
        await expect(disabledView).not.toBeFocused();
        await expect(disabled).toBeDisabled();
        await disabled.evaluate((input: HTMLInputElement) => input.click());
        await expect(disabled).toBeChecked();
        expect(await mixed.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
        await mixed.focus();
        await mixed.press("Space");
        await expect(mixed).toBeChecked();
        expect(await mixed.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
        await page.getByRole("button", { name: "Inspect form values", exact: true }).click();
        const entries = JSON.parse(await page.getByTestId("native-values").innerText());
        expect(entries).toEqual([
          ["include", "notes"],
          ["painted", "checked"],
          ["mixed", "included"],
          ["view", "grid"],
        ]);
        const changes = JSON.parse(
          await page.getByTestId("native-changes").innerText(),
        ) as string[];
        expect(changes).toContain("include:notes:true");
        expect(changes).toContain("view:grid:true");
        expect(changes.some((value) => value.startsWith("disabled"))).toBe(false);
      });

      test(`${theme}: checked checkbox and radio glyphs visibly contrast within their painted controls`, async ({
        page,
      }, info) => {
        await open(page, theme);
        const check = page.getByRole("checkbox", { name: "Checked example", exact: true });
        const radio = page.getByRole("radio", { name: "List", exact: true });
        const checkPixels = await paintedControl(
          check,
          18,
          info.outputPath(`native-check-${theme}.png`),
        );
        let darkest = [255, 255, 255],
          lightest = [0, 0, 0];
        for (let y = 4; y < 14; y++)
          for (let x = 4; x < 14; x++) {
            const value = checkPixels.at(x, y);
            if (luminance(value) < luminance(darkest)) darkest = value;
            if (luminance(value) > luminance(lightest)) lightest = value;
          }
        expect(
          contrast(darkest, lightest),
          "The check glyph must visibly contrast inside the filled box",
        ).toBeGreaterThanOrEqual(4.5);
        const radioPixels = await paintedControl(
          radio,
          16,
          info.outputPath(`native-radio-${theme}.png`),
        );
        expect(
          contrast(radioPixels.at(8, 8), radioPixels.at(3, 8)),
          "The selected radio dot must remain visible",
        ).toBeGreaterThanOrEqual(4.5);
        const label = check.locator("..");
        if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))
          expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      });

      test(`${theme}: forced colors restores native paint without removing focus, values or disabled behavior`, async ({
        page,
      }, info) => {
        await open(page, theme);
        await page.emulateMedia({
          forcedColors: "active",
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        const check = page.getByRole("checkbox", { name: "Include notes", exact: true });
        const disabled = page.getByRole("checkbox", { name: "Disabled example", exact: true });
        await expect(check).toHaveCSS("appearance", "auto");
        await expect(check).toHaveCSS("background-image", "none");
        const adjustment = await check.evaluate((input) => ({
          supported: CSS.supports("forced-color-adjust", "auto"),
          value: getComputedStyle(input).getPropertyValue("forced-color-adjust"),
        }));
        // An unsupported property has no computed value. Supported engines
        // must still honor auto; the paint and behavior checks below always run.
        expect(adjustment.value).toBe(adjustment.supported ? "auto" : "");
        await check.focus();
        await check.press("Space");
        await expect(check).toBeChecked();
        await expect(check).toHaveCSS("outline-style", "solid");
        const pixels = await paintedControl(
          check,
          18,
          info.outputPath(`native-forced-colors-${theme}.png`),
        );
        let darkest = [255, 255, 255],
          lightest = [0, 0, 0];
        for (let y = 3; y < pixels.height - 3; y++)
          for (let x = 3; x < pixels.width - 3; x++) {
            const value = pixels.at(x, y);
            if (luminance(value) < luminance(darkest)) darkest = value;
            if (luminance(value) > luminance(lightest)) lightest = value;
          }
        expect(contrast(darkest, lightest)).toBeGreaterThanOrEqual(4.5);
        await disabled.evaluate((input: HTMLInputElement) => input.click());
        await expect(disabled).toBeChecked();
        await expect(disabled).toBeDisabled();
        const list = page.getByRole("radio", { name: "List", exact: true });
        const grid = page.getByRole("radio", { name: "Grid", exact: true });
        await expect(list).toHaveCSS("appearance", "auto");
        const unselectedRadio = await paintedControl(
          grid,
          16,
          info.outputPath(`native-radio-unselected-forced-${theme}.png`),
        );
        await list.focus();
        await list.press("ArrowRight");
        await expect(grid).toBeChecked();
        await expect(grid).toBeFocused();
        await expect(
          page.getByRole("radio", { name: "Disabled view", exact: true }),
        ).toBeDisabled();
        const radio = await paintedControl(
          grid,
          16,
          info.outputPath(`native-radio-forced-${theme}.png`),
        );
        // Native selection can invert the fill while leaving the center a
        // similar color. Check the glyph inside the border, then require a
        // visible change across multiple matching pixels in the two states.
        let radioDarkest = [255, 255, 255],
          radioLightest = [0, 0, 0],
          changedPixels = 0;
        for (let y = 3; y < radio.height - 3; y++)
          for (let x = 3; x < radio.width - 3; x++) {
            const value = radio.at(x, y);
            if (luminance(value) < luminance(radioDarkest)) radioDarkest = value;
            if (luminance(value) > luminance(radioLightest)) radioLightest = value;
            if (contrast(value, unselectedRadio.at(x, y)) >= 4.5) changedPixels++;
          }
        expect(
          contrast(radioDarkest, radioLightest),
          "The native selected dot must contrast with its surrounding fill",
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          changedPixels,
          "Selection must visibly change at least four interior pixels at 4.5:1 contrast",
        ).toBeGreaterThanOrEqual(4);
        const form = await page
          .getByTestId("native-form")
          .evaluate((element: HTMLFormElement) => Array.from(new FormData(element).entries()));
        expect(form).toContainEqual(["include", "notes"]);
        expect(form.some(([name]) => name.startsWith("disabled"))).toBe(false);
      });
    }
  });
}
