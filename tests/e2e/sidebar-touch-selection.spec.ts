import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

test("selecting transcript text cancels a pending sidebar swipe", async ({ page }) => {
  await coreFixture(page, "dark");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const response = page.getByRole("article", { name: "KovaGPT response", exact: true });
  await expect(response).toBeVisible();
  const sidebar = page.locator(".kova-sidebar[data-kova-core-sidebar]");
  await expect(sidebar).toHaveAttribute("data-state", "closed");
  await response.evaluate((element) => {
    const paragraph = element.querySelector("p")!;
    const rect = paragraph.getBoundingClientRect();
    const touch = (clientX: number) =>
      new Touch({
        identifier: 1,
        target: paragraph,
        clientX,
        clientY: rect.top + 10,
      });
    const start = touch(rect.right - 10);
    paragraph.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [start] }));
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    const end = touch(rect.right - 120);
    paragraph.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [end] }));
  });
  await expect(sidebar).toHaveAttribute("data-state", "closed");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
    "practical release checklist",
  );
  // Ending selection cannot revive the cancelled gesture.
  await response.evaluate((element) => {
    window.getSelection()!.removeAllRanges();
    const paragraph = element.querySelector("p")!;
    const rect = paragraph.getBoundingClientRect();
    const touch = new Touch({
      identifier: 1,
      target: paragraph,
      clientX: rect.right - 130,
      clientY: rect.top + 10,
    });
    paragraph.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [touch] }));
    paragraph.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
  });
  await expect(sidebar).toHaveAttribute("data-state", "closed");
  // Cancellation affects this touch only. A new deliberate swipe still works.
  await response.evaluate((element) => {
    const paragraph = element.querySelector("p")!;
    const rect = paragraph.getBoundingClientRect();
    for (const [name, x] of [
      ["touchstart", rect.right - 10],
      ["touchmove", rect.right - 120],
    ] as const) {
      const touch = new Touch({
        identifier: 2,
        target: paragraph,
        clientX: x,
        clientY: rect.top + 10,
      });
      paragraph.dispatchEvent(new TouchEvent(name, { bubbles: true, touches: [touch] }));
    }
    paragraph.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
  });
  if (page.viewportSize()!.width < 1024) {
    await expect(sidebar).toHaveAttribute("data-state", "open");
    const drawer = page.getByRole("dialog", { name: "Primary navigation", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close sidebar", exact: true })).toBeVisible();
    await drawer.evaluate((element) => {
      for (const [name, x] of [
        ["touchstart", 40],
        ["touchmove", 160],
      ] as const) {
        const touch = new Touch({ identifier: 3, target: element, clientX: x, clientY: 100 });
        element.dispatchEvent(new TouchEvent(name, { bubbles: true, touches: [touch] }));
      }
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
    });
  }
  await expect(sidebar).toHaveAttribute("data-state", "closed");
});

test("workspace search cancels an in-progress drawer closing swipe", async ({ page }) => {
  await coreFixture(page, "dark");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const sidebar = await revealSidebar(page);
  await sidebar.evaluate((element) => {
    const touch = new Touch({ identifier: 1, target: element, clientX: 40, clientY: 100 });
    element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch] }));
  });
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", {
    name: "Search workspace, chats, and actions",
    exact: true,
  });
  await expect(palette).toBeVisible();
  // Use the mounted sidebar, which is now absent from the accessibility tree.
  const inactiveSidebar = page.locator(".kova-sidebar[data-kova-core-sidebar]");
  await expect(inactiveSidebar).toHaveJSProperty("inert", true);
  await inactiveSidebar.evaluate((element) => {
    const touch = new Touch({ identifier: 1, target: element, clientX: 160, clientY: 100 });
    element.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [touch] }));
    element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
  });
  await expect(inactiveSidebar).toHaveAttribute("data-state", "open");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-state", "open");
});
