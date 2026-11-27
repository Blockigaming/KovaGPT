import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";
import { fixture, functionNames, owner } from "./actual-app-fixture";

test("mobile chat restores the reading position after switching conversations", async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 1024, "compact shell");
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.route("**/mobile-reading-preview.png", (route) =>
    route.fulfill({ contentType: "image/png", path: "public/kova-logo.png" }),
  );
  await page.addInitScript((userId) => {
    const now = Date.now();
    const thumbnail =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const chats = [
      {
        id: "reading-position",
        title: "Reading position",
        messages: [
          {
            id: "prompt",
            role: "user",
            content: "Read these passages.",
            attachments: Array.from({ length: 4 }, () => ({ kind: "image", dataUrl: thumbnail })),
          },
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
          {
            id: "different-message",
            role: "assistant",
            content: `A separate conversation.\n\n![A separate preview](${location.origin}/mobile-reading-preview.png)`,
          },
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
  const images = transcript.getByRole("group", { name: "Attached images" });
  await expect(images.getByRole("button", { name: /^Attached image \d of 4$/ })).toHaveCount(4);
  const thumbnails = await images.evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    mode: getComputedStyle(element).overflowX,
  }));
  if (page.viewportSize()!.width < 768) {
    expect(thumbnails.overflow).toBeGreaterThan(0);
    expect(thumbnails.mode).toBe("auto");
  } else {
    expect(thumbnails.overflow).toBeLessThanOrEqual(1);
  }
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
  const preview = transcript.getByRole("button", { name: "View full size" });
  await preview.tap();
  const imageViewer = page.getByRole("dialog", { name: "A separate preview" });
  await expect(imageViewer).toBeVisible();
  const viewport = page.viewportSize()!;
  if (viewport.width < 768 || viewport.height <= 500) {
    await expect.poll(async () => (await imageViewer.boundingBox())?.width).toBe(viewport.width);
    await expect.poll(async () => (await imageViewer.boundingBox())?.height).toBe(viewport.height);
  }
  const zoom = imageViewer.getByRole("button", { name: "Zoom image" });
  const close = imageViewer.getByRole("button", { name: "Close", exact: true });
  const [zoomBox, closeBox] = await Promise.all([zoom.boundingBox(), close.boundingBox()]);
  expect(Math.min(zoomBox!.width, zoomBox!.height)).toBeGreaterThanOrEqual(44);
  expect(Math.min(closeBox!.width, closeBox!.height)).toBeGreaterThanOrEqual(44);
  const controlGap = Math.max(
    closeBox!.x - (zoomBox!.x + zoomBox!.width),
    zoomBox!.y - (closeBox!.y + closeBox!.height),
  );
  expect(controlGap).toBeGreaterThanOrEqual(8);
  await close.tap();
  await expect(preview).toBeFocused();
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

    const opener = page.getByRole("button", { name: /^(Open menu|Search chats)$/ }).filter({
      visible: true,
    });
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
    const coarsePointer = await page.evaluate(
      () => matchMedia("(width < 1024px) and (pointer: coarse)").matches,
    );
    // A touch screen keeps the 44px target even with the docked desktop layout.
    expect(closeBox?.height).toBe(
      coarsePointer || (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))
        ? 44
        : 36,
    );

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
  test.skip(
    viewport.width >= 1024 &&
      !(await page.evaluate(
        () => matchMedia("(width < 1024px) and (pointer: coarse) and (hover: none)").matches,
      )),
    "drawer layout",
  );
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const main = page.locator(".kova-chat-main");
  const opener = page.getByRole("button", { name: "Open menu" });
  await expect(opener).toBeVisible();
  await expect(main).toHaveAttribute("data-sidebar", "closed");
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();
  const phoneLayout = await page.evaluate(
    () =>
      matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
        .matches,
  );
  await expect
    .poll(async () => (await drawer.boundingBox())?.width)
    .toBeCloseTo(phoneLayout ? Math.min(viewport.width * 0.86, 360) : 260, 0);
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
  const projectViewport = page.viewportSize()!;
  test.skip(projectViewport.width >= 1024, "compact shell");
  const viewport =
    projectViewport.width > projectViewport.height ? { width: 667, height: 375 } : projectViewport;
  await page.setViewportSize(viewport);
  await fixture(page, "dark");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const textbox = page.getByRole("textbox", { name: "Message KovaGPT" });
  const compactPhone = viewport.width < 768 || viewport.height <= 500;
  if (compactPhone) await expect(textbox).toBeFocused();
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
  if (compactPhone) {
    const composerFrame = page.locator(".spec400-composer:visible");
    await expect(composerFrame).toHaveCSS("border-radius", "24px");
    const composer = (await composerFrame.boundingBox())!;
    // The app shell shows its welcome mark here; the website shows its greeting.
    const logo = page.locator(".kova-empty-chat .kova-greeting");
    await expect(logo).toBeVisible();
    const logoBox = (await logo.boundingBox())!;
    const shellBox = (await shell.boundingBox())!;
    expect(logoBox.y).toBeGreaterThanOrEqual(shellBox.y);
    expect(logoBox.y + logoBox.height).toBeLessThanOrEqual(composer.y);
    const keyboardGap = visibleHeight - composer.y - composer.height;
    expect(keyboardGap).toBeCloseTo(8, 0);
  }
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

  await expect(textbox).toBeFocused();
  await page.getByRole("region", { name: "Conversation", exact: true }).click({
    position: { x: 4, y: 4 },
  });
  await expect(shell).not.toHaveAttribute("data-keyboard-open", "true");
  await expect(textbox).not.toBeFocused();
  await expect(textbox).toHaveValue("Keep this draft");
  const collapsedChromeHeight = viewport.height + 48;
  await page.setViewportSize({ width: viewport.width, height: collapsedChromeHeight });
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(collapsedChromeHeight);
  await page.setViewportSize(viewport);
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(viewport.height);
  await expect(textbox).toHaveValue("Keep this draft");
});

test("touch hold opens the chat menu without opening the conversation", async ({
  page,
  hasTouch,
  browserName,
}) => {
  test.skip(!hasTouch || browserName !== "chromium", "Chromium touch input");
  // Touch screens 1024px and wider use the docked desktop sidebar.
  test.skip(page.viewportSize()!.width >= 1024, "drawer navigation");
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.addInitScript((userId) => {
    const now = Date.now();
    localStorage.setItem(
      `nova-gpt-conversations-v3:user:${userId}`,
      JSON.stringify([
        {
          id: "hold-shortcut",
          title: "Hold shortcut",
          messages: [{ id: "hold-prompt", role: "user", content: "Shortcut fixture" }],
          mode: "instant",
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
  }, owner);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Open menu" }).tap();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  const row = drawer.getByRole("button", { name: "Open chat Hold shortcut" });
  await row.click({ trial: true });
  await expect(row).toBeVisible();
  const { x, y, width, height } = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = { x: x + width / 2, y: y + height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(drawer).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to project" })).toBeVisible();
  await expect(menu.getByText("Shortcut fixture", { exact: true })).toBeVisible();
  await expect(page.locator(".kova-held-chat-backdrop")).toBeVisible();
  await menu.getByRole("menuitem", { name: "Rename" }).tap();
  await expect(page.getByRole("dialog", { name: "Rename chat" })).toBeVisible();
});

test("touch home keeps the greeting centered and the composer text inset", async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch, "touch layout");
  await installAuthenticatedFixture(page, { preserveStorageOnReload: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".spec400-composer:visible");
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  const heading = page.locator(".kova-empty-chat .kova-greeting h1");
  await expect(input).toHaveAttribute("placeholder", "Work with KovaGPT");
  const [frame, text, greeting] = await Promise.all([
    composer.boundingBox(),
    input.boundingBox(),
    heading.boundingBox(),
  ]);
  const width = page.viewportSize()!.width;
  const height = page.viewportSize()!.height;
  const inset =
    text!.x -
    frame!.x +
    (await input.evaluate((field) => Number.parseFloat(getComputedStyle(field).paddingLeft)));
  const appShell = await page.evaluate(
    () => document.documentElement.dataset.kovaSurface === "app",
  );
  if ((appShell && (width < 768 || (width < 1024 && height <= 500))) || width < 768)
    expect(inset).toBeCloseTo(19, 0);
  else expect(inset).toBeGreaterThanOrEqual(19);
  // The app shell centers its greeting in the free space above a bottom
  // composer; the website keeps the desktop home with the greeting on top.
  if (appShell || width < 768)
    expect(greeting!.y + greeting!.height / 2).toBeGreaterThan(height * 0.3);
  expect(greeting!.y + greeting!.height).toBeLessThan(frame!.y);
});
