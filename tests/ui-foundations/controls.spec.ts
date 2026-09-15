import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const cancelLabel = "Cancel and keep my current project settings";
const confirmLabel = "Confirm changes to the selected project only";

async function dispatchSheetTouch(
  locator: Locator,
  type: "touchstart" | "touchmove" | "touchcancel" | "touchend",
  positions: number[],
) {
  await locator.evaluate(
    (element, { type, positions }) => {
      const touches = positions.map((clientY, identifier) => ({
        identifier,
        clientY,
        target: element,
      }));
      const options = { bubbles: true, cancelable: true };
      let event: Event | undefined;
      if (typeof Touch === "function" && typeof TouchEvent === "function") {
        try {
          event = new TouchEvent(type, {
            ...options,
            touches: touches.map((point) => new Touch(point)),
          });
        } catch (error) {
          // Some WebKit versions expose these functions but forbid construction.
          // Only construction is guarded; dispatch and handler failures remain visible.
          if (!(error instanceof TypeError)) throw error;
        }
      }
      if (!event) {
        // Desktop Firefox lacks Touch. Both fallbacks exercise the same React
        // handlers with their consumed fields, without patching browser globals.
        event = new Event(type, options);
        Object.defineProperty(event, "touches", { value: touches });
      }
      element.dispatchEvent(event);
    },
    { type, positions },
  );
}

async function bounded(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => {
      const rect = await locator.boundingBox();
      const viewport = page.viewportSize()!;
      return (
        !!rect &&
        rect.x >= -1 &&
        rect.y >= -1 &&
        rect.x + rect.width <= viewport.width + 1 &&
        rect.y + rect.height <= viewport.height + 1
      );
    })
    .toBe(true);
  const overflow = await locator.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, "surface must not silently clip horizontal content").toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  for (const dark of [false, true]) {
    for (const enlarged of [false, true]) {
      test(`${viewport.width}x${viewport.height} ${dark ? "dark" : "light"} ${enlarged ? "200%" : "100%"}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
        const visit = async (surface: string) => {
          await page.goto(`/?surface=${surface}`);
          await page.evaluate(
            ({ dark, enlarged }) => {
              document.documentElement.classList.toggle("dark", dark);
              document.documentElement.dataset.largeText = String(enlarged);
            },
            { dark, enlarged },
          );
        };
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        // These are actual React/Radix components and the entire application CSS,
        // not replicas. The synthetic fixtures never connect to a backend.
        for (const surface of [
          "dialog",
          "alert",
          "sheet-top",
          "sheet-bottom",
          "sheet-left",
          "sheet-right",
          "mobile",
        ]) {
          await test.step(surface, async () => {
            await visit(surface);
            await page.getByTestId("trigger").click();
            const content = page.getByTestId(
              surface === "mobile" ? "mobile-bottom-sheet" : "surface",
            );
            await bounded(content, page);
            // Keyboard focus stays within a modal even when the body is scrolled.
            for (let step = 0; step < 6; step++) {
              await page.keyboard.press("Tab");
              expect(await content.evaluate((node) => node.contains(document.activeElement))).toBe(
                true,
              );
            }
            const cancel = content.getByRole("button", { name: cancelLabel, exact: true });
            await cancel.scrollIntoViewIfNeeded();
            await expect(cancel).toBeInViewport();
            expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(43);
            expect(
              (await content
                .getByRole("button", { name: confirmLabel, exact: true })
                .boundingBox())!.height,
            ).toBeGreaterThanOrEqual(43);
            if (viewport.width === 390 && enlarged) {
              await page.screenshot({ path: testInfo.outputPath(`${surface}.png`) });
            }
            await page.keyboard.press("Escape");
            await expect(content).toBeHidden();
            await expect(page.getByTestId("trigger")).toBeFocused();
            await expect(page.getByRole("status")).toHaveText("No action taken");
          });
        }
        await test.step("long select options and keyboard selection", async () => {
          await visit("select");
          await page.getByTestId("trigger").focus();
          await page.keyboard.press("ArrowDown");
          await bounded(page.getByTestId("surface"), page);
          await page.keyboard.press("End");
          // Radix schedules keyboard focus; await the actual target, not a timer.
          await expect(
            page.getByRole("option", { name: "Final project", exact: true }),
          ).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("status")).toHaveText("final");
          await expect(page.getByTestId("trigger")).toBeFocused();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        });
        await test.step("popover scroll reachability", async () => {
          await visit("popover");
          await page.getByTestId("trigger").click();
          const content = page.getByTestId("surface");
          await bounded(content, page);
          const action = content.getByRole("button", { name: "Apply", exact: true });
          await action.scrollIntoViewIfNeeded();
          await action.click();
          await expect(page.getByRole("status")).toHaveText("Confirmed once");
          await page.keyboard.press("Escape");
          await expect(page.getByTestId("trigger")).toBeFocused();
        });
        expect(errors).toEqual([]);
      });
    }
  }
}

test("nested dropdown escapes the scroll container and stays keyboard operable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 520 });
  await page.goto("/?surface=dropdown");
  await page.getByTestId("trigger").click();
  await page.getByRole("menuitem", { name: "More project actions", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const nested = page.getByTestId("nested-surface");
  await bounded(nested, page);
  // Hit testing catches a visually clipped submenu that bounding boxes alone miss.
  const action = page.getByRole("menuitem", { name: "Apply nested action", exact: true });
  expect(
    await action.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit !== null && element.contains(hit);
    }),
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Confirmed once");
  await expect(page.getByTestId("trigger")).toBeFocused();
});

test("mobile sheet isolates background, respects a nested Escape, and resets canceled gestures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?surface=mobile-nested");
  const originalOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  await page.getByTestId("trigger").click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Choose a tool" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Outside action", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Close sheet", exact: true })).toBeFocused();

  const nested = sheet.getByRole("combobox", { name: "Choose a nested project" });
  await nested.click();
  await expect(page.getByTestId("nested-select")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nested-select")).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(nested).toBeFocused();

  const handle = sheet.locator("[data-kova-sheet-handle]");
  await dispatchSheetTouch(handle, "touchstart", [100]);
  await dispatchSheetTouch(handle, "touchmove", [160]);
  await expect(sheet).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 60)");
  await dispatchSheetTouch(handle, "touchcancel", []);
  await expect(sheet).toHaveCSS("transform", "none");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("trigger")).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .toBe(originalOverflow);

  await page.getByTestId("trigger").click();
  await expect(sheet).toHaveCSS("transform", "none");
  await dispatchSheetTouch(handle, "touchstart", [100]);
  await dispatchSheetTouch(handle, "touchmove", [210]);
  await dispatchSheetTouch(handle, "touchend", []);
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("trigger")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("No action taken");
});
