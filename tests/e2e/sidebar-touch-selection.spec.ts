import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

// Synthetic interruption events exercise the real listeners without browser-specific constructors.
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
    const touch = (clientX: number) => ({
      identifier: 1,
      target: paragraph,
      clientX,
      clientY: rect.top + 10,
    });
    const start = touch(rect.right - 10);
    paragraph.dispatchEvent(
      Object.assign(new Event("touchstart", { bubbles: true }), { touches: [start] }),
    );
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    const end = touch(rect.right - 120);
    paragraph.dispatchEvent(
      Object.assign(new Event("touchmove", { bubbles: true }), { touches: [end] }),
    );
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
    const touch = {
      identifier: 1,
      target: paragraph,
      clientX: rect.right - 130,
      clientY: rect.top + 10,
    };
    paragraph.dispatchEvent(
      Object.assign(new Event("touchmove", { bubbles: true }), { touches: [touch] }),
    );
    paragraph.dispatchEvent(
      Object.assign(new Event("touchend", { bubbles: true }), { touches: [] }),
    );
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
      const touch = {
        identifier: 2,
        target: paragraph,
        clientX: x,
        clientY: rect.top + 10,
      };
      paragraph.dispatchEvent(
        Object.assign(new Event(name, { bubbles: true }), { touches: [touch] }),
      );
    }
    paragraph.dispatchEvent(
      Object.assign(new Event("touchend", { bubbles: true }), { touches: [] }),
    );
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
        const touch = { identifier: 3, target: element, clientX: x, clientY: 100 };
        element.dispatchEvent(
          Object.assign(new Event(name, { bubbles: true }), { touches: [touch] }),
        );
      }
      element.dispatchEvent(
        Object.assign(new Event("touchend", { bubbles: true }), { touches: [] }),
      );
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
    const touch = { identifier: 1, target: element, clientX: 40, clientY: 100 };
    element.dispatchEvent(
      Object.assign(new Event("touchstart", { bubbles: true }), { touches: [touch] }),
    );
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
    const touch = { identifier: 1, target: element, clientX: 160, clientY: 100 };
    element.dispatchEvent(
      Object.assign(new Event("touchmove", { bubbles: true }), { touches: [touch] }),
    );
    element.dispatchEvent(Object.assign(new Event("touchend", { bubbles: true }), { touches: [] }));
  });
  await expect(inactiveSidebar).toHaveAttribute("data-state", "open");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-state", "open");
});

test("search takes keyboard focus before the next animation frame", async ({ page }) => {
  await coreFixture(page, "dark");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const sidebar = await revealSidebar(page);
  await page.evaluate(() => {
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1_000_000;
    window.requestAnimationFrame = (callback) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (!pending.delete(id)) cancel.call(window, id);
    };
    window.addEventListener(
      "kova-test-release-search-frames",
      () => {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of pending.values()) request.call(window, callback);
        pending.clear();
      },
      { once: true },
    );
  });
  try {
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", {
      name: "Search workspace, chats, and actions",
      exact: true,
    });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-state", "open");
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("kova-test-release-search-frames")));
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const initiallyOpen of [false, true]) {
    test(`${theme}: search action keeps the chosen sidebar state: ${initiallyOpen ? "open" : "closed"}`, async ({
      page,
    }) => {
      await coreFixture(page, theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      if (initiallyOpen) await revealSidebar(page);
      const sidebar = page.locator(".kova-sidebar[data-kova-core-sidebar]");
      const state = initiallyOpen ? "open" : "closed";
      await expect(sidebar).toHaveAttribute("data-state", state);
      await page.keyboard.press("Control+K");
      const palette = page.getByRole("dialog", {
        name: "Search workspace, chats, and actions",
        exact: true,
      });
      const query = palette.getByRole("combobox");
      await query.fill("Search workspace");
      await palette.getByRole("option", { name: "Search workspace", exact: true }).click();
      await expect(palette).toBeVisible();
      await expect(query).toHaveValue("");
      await expect(query).toBeFocused();
      await expect(sidebar).toHaveAttribute("data-state", state);
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      await expect(sidebar).toHaveAttribute("data-state", state);
    });

    test(`${theme}: management search preserves the drawer until a destination is selected: ${initiallyOpen ? "open" : "closed"}`, async ({
      page,
    }) => {
      await coreFixture(page, theme);
      await page.goto("/library", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      if (initiallyOpen) await revealSidebar(page);
      const sidebar = page.locator(".kova-sidebar[data-kova-core-sidebar]");
      const state = initiallyOpen ? "open" : "closed";
      await expect(sidebar).toHaveAttribute("data-state", state);
      const trigger = page
        .getByRole("button", {
          name: initiallyOpen ? "Search chats" : /^(?:Open menu|Expand sidebar)$/,
          exact: true,
        })
        .first();
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await page.keyboard.press("Control+K");
      const dialog = page.getByRole("dialog", { name: "Search chats", exact: true });
      const query = dialog.getByRole("textbox", { name: "Search chats", exact: true });
      await expect(dialog).toBeVisible();
      await expect(query).toBeFocused();
      await page.keyboard.press("Control+K");
      await expect(query).toBeFocused();
      await query.fill("Composer review");
      const result = dialog.getByRole("button", {
        name: "Open chat Composer review chat",
        exact: true,
      });
      await expect(result).toBeVisible();
      await expect(sidebar).toHaveAttribute("data-state", state);
      const rect = await dialog.boundingBox();
      expect(rect).not.toBeNull();
      const viewport = page.viewportSize()!;
      expect(rect!.x).toBeGreaterThanOrEqual(-1);
      expect(rect!.y).toBeGreaterThanOrEqual(-1);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
      if (initiallyOpen) {
        await result.click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator("[data-chat-transcript]")).toBeVisible();
        await expect(page.locator(".kova-sidebar[data-kova-core-sidebar]")).toHaveAttribute(
          "data-state",
          "closed",
        );
      } else {
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(sidebar).toHaveAttribute("data-state", state);
        await expect(trigger).toBeFocused();
      }
    });
  }
}
