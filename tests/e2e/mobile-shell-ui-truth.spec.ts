import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { fixture, functionNames, owner } from "./actual-app-fixture";

test("mobile chat restores the reading position after switching conversations", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 1024, "compact shell");
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.addInitScript((userId) => {
    const now = Date.now();
    const chats = [
      {
        id: "reading-position",
        title: "Reading position",
        messages: [
          { id: "prompt", role: "user", content: "Read these passages." },
          ...Array.from({ length: 18 }, (_, index) => ({
            id: `passage-${index}`,
            role: "assistant",
            content: `Passage ${index + 1}. ${"The previous page should stay available. ".repeat(4)}`,
            timestamp: now,
          })),
        ],
      },
      {
        id: "different-chat",
        title: "Different chat",
        messages: [
          { id: "different-message", role: "assistant", content: "A separate conversation." },
        ],
      },
    ].map((chat) => ({ ...chat, mode: "instant", createdAt: now, updatedAt: now }));
    localStorage.setItem(`nova-gpt-conversations-v3:user:${userId}`, JSON.stringify(chats));
    localStorage.setItem(
      `nova-gpt-settings-v1:${userId}`,
      JSON.stringify({ interfaceAccent: "#12abcd", contrast: "high" }),
    );
  }, owner);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  const openChat = async (title: string) => {
    await page.getByRole("button", { name: "Open menu" }).tap();
    await drawer.getByRole("button", { name: `Open chat ${title}` }).tap();
    await expect(drawer).toBeHidden();
  };
  await openChat("Reading position");
  const transcript = page.locator("[data-chat-transcript]");
  const bubble = transcript.getByLabel("Sent prompt");
  await expect(bubble).toHaveCSS("background-color", "rgb(18, 171, 205)");
  await expect(bubble).toHaveCSS("color", "rgb(0, 0, 0)");
  const passage = transcript.locator('[data-message-id="passage-5"]');
  await expect(passage).toBeAttached();
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await passage.evaluate((element) =>
    element.scrollIntoView({ block: "start", behavior: "instant" }),
  );
  await expect(passage).toBeInViewport();
  const passageOffset = () =>
    passage.evaluate((element) => {
      const viewport = element.closest("[data-chat-transcript]")!;
      return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    });
  const originalOffset = await passageOffset();
  await openChat("Different chat");
  await expect(transcript.getByText("A separate conversation.")).toBeVisible();
  await openChat("Reading position");
  await expect(passage).toBeInViewport();
  await expect.poll(passageOffset).toBeCloseTo(originalOffset, 0);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).not.toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-kova-contrast", "high");
});

test.describe("mobile shell UI truth", () => {
  test.beforeEach(async ({ page }) => {
    await installAuthenticatedFixture(page);
  });
  test("the phone drawer reaches the left, top and bottom edges and restores focus", async ({
    page,
  }) => {
    const viewport = page.viewportSize();
    test.skip(
      !viewport || (viewport.width >= 768 && viewport.height >= 500),
      "phone portrait and landscape drawer contract",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const opener = page.getByRole("button", { name: "Open menu" });
    await opener.focus();
    await opener.click();

    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(drawer).toBeVisible();
    await expect.poll(async () => (await drawer.boundingBox())?.x ?? 0).toBeCloseTo(0, 0);
    const box = (await drawer.boundingBox())!;
    expect(box.y).toBeCloseTo(0, 0);
    expect(box.height).toBeCloseTo(viewport.height, 0);
    expect(box.width).toBeLessThan(viewport.width);

    const close = page.getByRole("button", { name: "Close sidebar", exact: true });
    // Translation can briefly subtract fractional edges as 43.99998px for a
    // 44px control. Wait for settled geometry and keep the exact target minimum.
    await expect
      .poll(async () => {
        const closeBox = await close.boundingBox();
        return closeBox ? Math.min(closeBox.width, closeBox.height) : 0;
      })
      .toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(opener).toBeFocused();
  });

  test("the command palette is unclipped, motion-safe, and restores its opener", async ({
    page,
  }) => {
    const viewport = page.viewportSize()!;
    await page.route("**/_serverFn/**", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (functionNames.get(id)?.startsWith("listWorkspaceRecents_"))
        return route.fulfill({ status: 503, json: { error: "Workspace unavailable in fixture" } });
      return route.fallback();
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    const opener =
      viewport.width < 1024
        ? page.getByRole("button", { name: "Open menu" })
        : page.getByRole("button", { name: "Search chats", exact: true });
    await opener.focus();
    const openerHandle = await opener.elementHandle();
    expect(openerHandle).not.toBeNull();
    await page.keyboard.press("Control+K");

    const palette = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
    await expect(palette).toBeVisible();
    await expect(
      palette.getByText("Workspace results are unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(
      palette.getByRole("combobox", { name: "Search workspace, commands, and chats" }),
    ).toBeFocused();
    const paletteBox = await palette.boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(paletteBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);

    const close = page.getByRole("button", { name: "Close command palette" });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    const coarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(closeBox?.height).toBe(coarsePointer ? 44 : 36);

    const panel = palette.locator(":scope > div").first();
    const animationDuration = await panel.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).animationDuration) || 0,
    );
    expect(animationDuration).toBeLessThanOrEqual(0.01);

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect
      .poll(() => openerHandle!.evaluate((element) => element === document.activeElement))
      .toBe(true);

    await page.keyboard.press("Control+K");
    await expect(palette).toBeVisible();
    await page.getByRole("option", { name: "Focus message box" }).click();
    await expect(palette).toBeHidden();
    await expect(page.locator("textarea").first()).toBeFocused();
    await expect
      .poll(() => openerHandle!.evaluate((element) => element === document.activeElement))
      .toBe(false);
  });
});

test("compact chat starts closed and keeps its canvas in place behind the drawer", async ({
  page,
}) => {
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 1024, "compact shell");
  await installAuthenticatedFixture(page, { preserveStorageOnReload: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const main = page.locator(".kova-chat-main");
  const opener = page.getByRole("button", { name: "Open menu" });
  await expect(opener).toBeVisible();
  await expect(main).toHaveAttribute("data-sidebar", "closed");
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => (await drawer.boundingBox())?.width)
    .toBeCloseTo(Math.min(viewport.width * 0.86, 320), 0);
  const mainBox = (await main.boundingBox())!;
  expect(mainBox.x).toBe(0);
  expect(mainBox.width).toBe(viewport.width);

  await page.evaluate(() => localStorage.setItem("kova-mobile-sidebar-open", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(opener).toBeVisible();
  await expect(main).toHaveAttribute("data-sidebar", "closed");
});

test("a reduced visual viewport keeps the mobile composer reachable", async ({ page }) => {
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 1024, "compact shell");
  await installAuthenticatedFixture(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const textbox = page.getByRole("textbox", { name: "Message KovaGPT" });
  await textbox.fill("Keep this draft");
  const visibleHeight = viewport.height - (viewport.height < 500 ? 145 : 300);
  await page.evaluate((height) => {
    const visual = window.visualViewport!;
    Object.defineProperty(visual, "height", { configurable: true, value: height });
    visual.dispatchEvent(new Event("resize"));
  }, visibleHeight);

  const shell = page.locator(".kova-assistant[data-ui=modern]");
  await expect(shell).toHaveAttribute("data-keyboard-open", "true");
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(visibleHeight);
  const send = page.getByRole("button", { name: "Send message" });
  const sendBox = (await send.boundingBox())!;
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(visibleHeight + 1);

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  await expect.poll(async () => (await palette.boundingBox())?.height).toBe(visibleHeight);
  const panel = palette.locator('[data-slot="command-palette-content"]');
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(visibleHeight + 1);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await textbox.blur();
  await expect(shell).not.toHaveAttribute("data-keyboard-open", "true");
  await expect(textbox).toHaveValue("Keep this draft");
});
