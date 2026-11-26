import { expect, test, type Page } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

const content = [
  "# A readable response",
  "A paragraph with **emphasis**, a [sample link](https://example.com), and enough text to wrap naturally on a phone without changing the type scale.",
  "## A second heading",
  "- First list item\n- Second list item",
  "> A quotation that retains its indentation when the viewport changes.",
  '```javascript\nconst example = "' + "long-local-scroll-".repeat(40) + '";\n```',
  "| First | Second | Third | Fourth | Fifth | Sixth |\n| --- | --- | --- | --- | --- | --- |\n| Alpha | Bravo | Charlie | Delta | Echo | Foxtrot |",
].join("\n\n");

async function openResponse(page: Page, theme: "light" | "dark") {
  await fixture(page, theme, true, true, "plus", {
    savedMessages: [{ id: "ratio-rich-output", role: "assistant", content }],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "A readable response" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function typography(page: Page) {
  return page.locator(".kova-assistant-message .prose-chat").evaluate((root) => {
    // Kova deliberately renders a quoted output as its own Text content box.
    const selectors = [
      "p",
      "h1",
      "h2",
      "ul",
      '[data-output-kind="text"] .kova-response-output-content',
      "pre",
      "td",
      "th",
    ];
    return selectors.map((selector) => {
      const element = root.querySelector(selector)!;
      if (!element) throw new Error(`Missing rendered rich content: ${selector}`);
      const style = getComputedStyle(element);
      return {
        selector,
        font: style.fontSize,
        line: style.lineHeight,
        family: style.fontFamily,
        weight: style.fontWeight,
        padding: style.padding,
        margin: style.margin,
      };
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: rich content keeps desktop type and scrolls inside its frame`, async ({
    page,
    browser,
  }, info) => {
    await openResponse(page, theme);
    const referenceContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4189",
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    try {
      const desktop = await referenceContext.newPage();
      await openResponse(desktop, theme);
      const [actual, expected] = await Promise.all([typography(page), typography(desktop)]);
      const viewport = page.viewportSize()!;
      const phone = viewport.width < 768 || viewport.height <= 500;
      // The tablet retains the existing compact shell; phone equivalence starts
      // at the documented media boundary, rather than restyling the tablet too.
      if (phone || viewport.width >= 1024) expect(actual).toEqual(expected);
      if (phone) {
        const code = page.locator('[data-output-kind="code"] .kova-response-output-content');
        const desktopCode = desktop.locator(
          '[data-output-kind="code"] .kova-response-output-content',
        );
        const inset = (locator: typeof code) =>
          locator.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
        expect((await inset(code)) / (await inset(desktopCode))).toBeCloseTo(0.8, 2);
      }
      const overflow = await page
        .locator(".kova-assistant-message .prose-chat")
        .evaluate((element) => {
          const pre = element.querySelector("pre")!;
          const table = element.querySelector(".kova-table-scroll")!;
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            preMode: getComputedStyle(pre).overflowX,
            preOverflow: pre.scrollWidth - pre.clientWidth,
            tableMode: getComputedStyle(table).overflowX,
            tableOverflow: table.scrollWidth - table.clientWidth,
          };
        });
      expect(overflow.page).toBeLessThanOrEqual(1);
      expect(overflow.preMode).toBe("auto");
      expect(overflow.preOverflow).toBeGreaterThan(0);
      expect(overflow.tableMode).toBe("auto");
      if (viewport.width < 768) expect(overflow.tableOverflow).toBeGreaterThan(0);
      await page.screenshot({ path: info.outputPath("rich-output.png") });
      const trigger = page.getByRole("button", { name: /^Choose model and effort/ });
      await trigger.click();
      const menu = page.locator(".kova-consumer-model-menu");
      await expect(menu).toBeVisible();
      // The entry animation scales the painted bounds while the CSS width is
      // already correct. Compare the settled menu, not an intermediate frame.
      const composer = page.locator(".spec400-composer:visible").first();
      const composerBox = (await composer.boundingBox())!;
      // Phones dock the popup above the chat bar at the chat bar's width.
      const narrow = viewport.width < 768;
      const expectedWidth = narrow ? composerBox.width : Math.min(282, viewport.width - 24);
      await expect
        .poll(async () => (await menu.boundingBox())?.width)
        .toBeCloseTo(expectedWidth, 0);
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      if (narrow) {
        const composerRadius = await composer.evaluate(
          (el) => getComputedStyle(el).borderTopLeftRadius,
        );
        await expect(menu).toHaveCSS("border-radius", composerRadius);
        expect(box.y + box.height).toBeLessThanOrEqual(composerBox.y + 1);
      } else if (phone) {
        await expect(menu).toHaveCSS("border-radius", "18px");
        expect(box.width).toBeCloseTo(Math.min(282, viewport.width - 24), 0);
      }
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await referenceContext.close();
    }
  });
}
