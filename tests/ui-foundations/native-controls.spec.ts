import { expect, test, type Page } from "@playwright/test";
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
        await expect(list).toBeChecked();
        await expect(list).toBeFocused();
        await list.press("ArrowLeft");
        await expect(grid).toBeChecked();
        await expect(
          page.getByRole("radio", { name: "Disabled view", exact: true }),
        ).not.toBeChecked();
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
        const checkPixels = bitmap(
          await check.screenshot({
            path: info.outputPath(`native-check-${theme}.png`),
            scale: "css",
          }),
        );
        expect([checkPixels.width, checkPixels.height]).toEqual([18, 18]);
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
        const radioPixels = bitmap(
          await radio.screenshot({
            path: info.outputPath(`native-radio-${theme}.png`),
            scale: "css",
          }),
        );
        expect([radioPixels.width, radioPixels.height]).toEqual([16, 16]);
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
        await expect(check).toHaveCSS("forced-color-adjust", "auto");
        await check.focus();
        await check.press("Space");
        await expect(check).toBeChecked();
        await expect(check).toHaveCSS("outline-style", "solid");
        const pixels = bitmap(
          await check.screenshot({
            path: info.outputPath(`native-forced-colors-${theme}.png`),
            scale: "css",
          }),
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
        const unselectedRadio = bitmap(await grid.screenshot({ scale: "css" }));
        await list.focus();
        await list.press("ArrowRight");
        await expect(grid).toBeChecked();
        await expect(grid).toBeFocused();
        await expect(
          page.getByRole("radio", { name: "Disabled view", exact: true }),
        ).toBeDisabled();
        const radio = bitmap(
          await grid.screenshot({
            path: info.outputPath(`native-radio-forced-${theme}.png`),
            scale: "css",
          }),
        );
        // Native high-contrast radio geometry belongs to the browser. Compare
        // the same center before/after selection rather than assuming a ring inset.
        expect(contrast(radio.at(8, 8), unselectedRadio.at(8, 8))).toBeGreaterThanOrEqual(4.5);
        const form = await page
          .getByTestId("native-form")
          .evaluate((element: HTMLFormElement) => Array.from(new FormData(element).entries()));
        expect(form).toContainEqual(["include", "notes"]);
        expect(form.some(([name]) => name.startsWith("disabled"))).toBe(false);
      });
    }
  });
}
