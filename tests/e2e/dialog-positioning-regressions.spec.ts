import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { coreFixture } from "./core-app-fixture";
import { openCurrentSettings } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-320x700", "phone-390x844", "tablet-1024x768", "desktop-1440x900"]);
test.beforeEach(({ page: _page }, info) => test.skip(!projects.has(info.project.name)));

async function contained(page: Page, surface: Locator) {
  await expect(surface).toBeVisible();
  const geometry = await surface.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      rect: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      },
      viewport: { width: innerWidth, height: innerHeight },
      css: {
        position: style.position,
        left: style.left,
        top: style.top,
        right: style.right,
        bottom: style.bottom,
        transform: style.transform,
        translate: style.translate,
        overflowY: style.overflowY,
      },
    };
  });
  await test.info().attach("actual-dialog-positioning", {
    body: JSON.stringify({ url: page.url(), ...geometry }, null, 2),
    contentType: "application/json",
  });
  await expect
    .poll(async () =>
      surface.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.x >= -0.01 &&
          box.y >= -0.01 &&
          box.right <= innerWidth + 0.01 &&
          box.bottom <= innerHeight + 0.01
        );
      }),
    )
    .toBe(true);
  const overflow = await surface.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, "The visible surface must not clip horizontal content").toBeLessThanOrEqual(1);
}
async function usableClose(page: Page, button: Locator) {
  await expect(button).toBeVisible();
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(
    await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit !== null && element.contains(hit);
    }),
    "The close control must receive pointer hits inside the viewport",
  ).toBe(true);
  const target = await button.boundingBox();
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await test.info().attach("actual-close-target", {
    body: JSON.stringify({ coarse, rect: target }, null, 2),
    contentType: "application/json",
  });
  expect(target!.width).toBeGreaterThanOrEqual(coarse ? 44 : 32);
  expect(target!.height).toBeGreaterThanOrEqual(coarse ? 44 : 32);
}
async function focusStaysInside(page: Page, surface: Locator) {
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("Tab");
    expect(await surface.evaluate((element) => element.contains(document.activeElement))).toBe(
      true,
    );
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Settings workspace keeps its closed rail and reachable close control while content scrolls`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme, "free", { preserveStorageOnReload: true });
    await page.goto("/settings/responses");
    await waitForKovaHydration(page);
    const fullpage = page.locator(".kova-settings-page");
    const pageColor = await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(fullpage).toHaveCSS("background-color", pageColor);
    await expect(fullpage.locator(".kova-settings-content")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await page.goto("/images");
    await waitForKovaHydration(page);
    const modal = await openCurrentSettings(page);
    await contained(page, modal);
    const heading = modal.getByRole("heading").filter({ visible: true }).first();
    await expect(heading).toBeInViewport({ ratio: 1 });
    const close = modal.getByRole("button", { name: "Close settings", exact: true });
    await usableClose(page, close);
    await expect(modal).toHaveCSS("background-color", pageColor);
    const content = modal.locator(".kova-settings-content");
    await expect(content).toHaveCSS("overflow-y", "auto");
    await expect
      .poll(() =>
        content.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          return element.scrollHeight <= element.clientHeight || element.scrollTop > 0;
        }),
      )
      .toBe(true);
    await usableClose(page, close);
    await expect(
      page.getByRole("navigation", { name: "Primary navigation", exact: true }),
    ).toBeHidden();
    if (page.viewportSize()!.width >= 1024)
      await expect(
        page.getByRole("navigation", { name: "Collapsed navigation", exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`settings-contained-${theme}.png`),
      animations: "disabled",
      caret: "hide",
    });
    await close.click();
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeVisible();
  });

  test(`${theme}: Settings preserves a private image draft in its contained dialog`, async ({
    page,
  }) => {
    await coreFixture(page, theme);
    await page.goto("/images");
    await waitForKovaHydration(page);
    const prompt = page.getByRole("textbox", { name: "Describe the image to generate" });
    await prompt.fill("Keep this unsaved image idea");
    await openCurrentSettings(page);
    const modal = page.getByRole("dialog", { name: "Settings", exact: true });
    await contained(page, modal);
    const close = modal.getByRole("button", { name: "Close settings", exact: true });
    await usableClose(page, close);
    await focusStaysInside(page, modal);
    await close.click();
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/images(?:[?#]|$)/);
    await expect(prompt).toHaveValue("Keep this unsaved image idea");
  });

  test(`${theme}: Connections metadata details have one centering transform and a reachable close control`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    await page.goto("/apps");
    await waitForKovaHydration(page);
    const card = page.locator('[data-plugin-id="github"]');
    const details = card.getByRole("button", { name: "Coming soon GitHub", exact: true });
    await expect(details).toBeVisible();
    await details.click(); // This card action opens metadata; it never connects a provider.
    const modal = page.getByRole("dialog", { name: "GitHub", exact: true });
    await contained(page, modal);
    await expect(modal.getByRole("heading", { name: "GitHub", exact: true })).toBeInViewport({
      ratio: 1,
    });
    const close = modal.getByRole("button", { name: "Close connection details", exact: true });
    await usableClose(page, close);
    const scrolling = await modal.evaluate((element) => ({
      overflow: getComputedStyle(element).overflowY,
      height: element.clientHeight,
      content: element.scrollHeight,
    }));
    expect(scrolling.overflow).toBe("auto");
    await modal.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await modal.evaluate((element) => {
      element.scrollTop = 0;
    });
    await usableClose(page, close);
    await focusStaysInside(page, modal);
    await page.screenshot({
      path: info.outputPath(`connections-contained-${theme}.png`),
      animations: "disabled",
      caret: "hide",
    });
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(details).toBeFocused();
    await expect(page).toHaveURL(/\/apps(?:[?#]|$)/);
  });

  test(`${theme}: Sources drawer stays docked inside the viewport and scrolls long local evidence`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true);
    let requests = 0;
    const sources = Array.from({ length: 12 }, (_, index) => ({
      id: `local-source-${index + 1}`,
      title: `Synthetic source ${index + 1}`,
      url: `https://example.invalid/review/${index + 1}`,
      domain: "example.invalid",
      snippet:
        "This local supporting passage exercises the real scrollable evidence surface. ".repeat(5),
      retrievedAt: "2026-10-17T12:00:00Z",
    }));
    await page.route("**/api/chat", (route) => {
      requests++;
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ choices: [{ delta: { kind: "web_sources", sources } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Read [the synthetic source](https://example.invalid/review/1)." } }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
      });
    });
    await page.goto("/");
    await waitForKovaHydration(page);
    await page
      .getByRole("textbox", { name: "Message KovaGPT", exact: true })
      .fill("Show the synthetic source.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const citation = page.getByRole("button", {
      name: "View source: Synthetic source 1",
      exact: true,
    });
    await expect(citation).toBeVisible();
    await citation.click();
    const drawer = page.getByRole("dialog", { name: "Sources", exact: true });
    await contained(page, drawer);
    const box = (await drawer.boundingBox())!;
    expect(box.x + box.width).toBeCloseTo(page.viewportSize()!.width, 1);
    expect(box.y).toBeCloseTo(0, 1);
    await expect(drawer.getByRole("heading", { name: "Sources", exact: true })).toBeInViewport({
      ratio: 1,
    });
    const close = drawer.getByRole("button", { name: "Close", exact: true });
    await usableClose(page, close);
    const list = drawer.locator("ol");
    await expect(list).toHaveCSS("overflow-y", "auto");
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    const last = drawer.getByRole("heading", { name: "Synthetic source 12", exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await usableClose(page, close);
    await focusStaysInside(page, drawer);
    await page.screenshot({
      path: info.outputPath(`sources-contained-${theme}.png`),
      animations: "disabled",
      caret: "hide",
    });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(citation).toBeFocused();
    expect(requests).toBe(1);
    expect(page.context().pages()).toHaveLength(1);
  });
}
