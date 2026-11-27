import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixture } from "../e2e/actual-app-fixture";
import { waitForCommittedChat } from "../e2e/chat-history-commit";
import { coreFixture } from "../e2e/core-app-fixture";
import { revealSidebar, usesSidebarDrawer } from "../e2e/current-ui";
import { waitForKovaHydration } from "../e2e/hydration";

async function expectReachable(control: Locator, top: number, bottom: number) {
  await expect(control).toBeVisible();
  await expect(async () => {
    const geometry = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const ancestors = [];
      for (
        let node = element.parentElement;
        node && ancestors.length < 6;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        ancestors.push({
          className: node.className,
          box: node.getBoundingClientRect().toJSON(),
          scrollTop: node.scrollTop,
          maxHeight: style.maxHeight,
          minHeight: style.minHeight,
          flex: style.flex,
          overflow: style.overflow,
          translate: style.translate,
          transform: style.transform,
        });
      }
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: document.documentElement.clientWidth,
        receivesPointer: hit !== null && element.contains(hit),
        hit: hit?.outerHTML.slice(0, 250),
        ancestors,
      };
    });
    expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(top - 1);
    expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(bottom + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.receivesPointer, JSON.stringify(geometry)).toBe(true);
  }).toPass({ timeout: 5_000 });
}

async function simulateKeyboard(page: Page, height: number, top: number) {
  await page.evaluate(
    ({ height, top }) => {
      const visual = window.visualViewport!;
      Object.defineProperties(visual, {
        height: { configurable: true, value: height },
        offsetTop: { configurable: true, value: top },
      });
      visual.dispatchEvent(new Event("resize"));
      visual.dispatchEvent(new Event("scroll"));
    },
    { height, top },
  );
  await expect(page.locator("html")).toHaveAttribute("data-kova-keyboard");
}

test("a transient history storage failure recovers without reloading or losing the draft", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone-390");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, "dark", true, true);
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let failOnce = true;
    indexedDB.open = (name, version) => {
      if (name === "kovagpt-chat-history-v1" && failOnce) {
        failOnce = false;
        throw new DOMException("Storage temporarily unavailable", "UnknownError");
      }
      return version === undefined ? open(name) : open(name, version);
    };
  });
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Recovered chat reply"}}]}\n\ndata: [DONE]\n\n',
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const draft = "Keep this draft across a browser storage retry.";
  const retry = page.getByRole("button", { name: "Retry chat sync", exact: true });
  await expect(retry).toBeEnabled();
  await input.fill(draft);
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeDisabled();
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(input).toHaveValue(draft);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("Recovered chat reply", { exact: true })).toBeVisible();
  await waitForCommittedChat(page, draft);
  expect(errors).toEqual([]);
});

test("chat search keeps the back button and message matches reachable above the keyboard", async ({
  page,
}, info) => {
  test.skip(!["phone-320", "phone-390", "landscape-844"].includes(info.project.name));
  await fixture(page, "dark", true, true);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const drawer = await revealSidebar(page);
  const trigger = drawer.getByRole("button", { name: "Search chats", exact: true });
  await trigger.click();
  const search = page.getByRole("dialog", { name: "Search chats", exact: true });
  const field = search.getByRole("searchbox");
  const back = search.getByRole("button", { name: "Close chat search", exact: true });
  await expect(field).toBeFocused();
  const height = Math.min(330, page.viewportSize()!.height - 140);
  await simulateKeyboard(page, height, 12);
  await field.fill("practical release unrelatedword");
  await expect(search.getByText("1 matching chat", { exact: true })).toBeAttached();
  const match = search.getByRole("button", { name: "Open chat Composer review chat", exact: true });
  await expect(match).toContainText("practical release checklist");
  await expectReachable(back, 12, 12 + height);
  await expectReachable(field, 12, 12 + height);
  await expectReachable(match, 12, 12 + height);
  await back.click();
  await expect(search).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("crossing the phone and tablet boundaries preserves the draft and model menu", async ({
  page,
}, info) => {
  test.skip(
    !["desktop-1440", "phone-390"].includes(info.project.name),
    "one fine and one coarse pointer sweep",
  );
  await coreFixture(page, "dark", "plus");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const draft = "Keep this draft across breakpoints.\nAnd keep the second line.";
  await input.fill(draft);
  for (const width of [767, 768, 1023, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toHaveValue(draft);
    await expect(input).toHaveCSS("font-size", "16px");
    const mobileHeader = page.locator(".kova-chat-main > .kova-topbar:not(.kova-desktop-topbar)");
    if (await usesSidebarDrawer(page)) await expect(mobileHeader).toBeVisible();
    else await expect(mobileHeader).toBeHidden();
    const trigger = page.getByRole("button", { name: /^Choose model and effort/ });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Select model", exact: true });
    await expect(menu).toBeVisible();
    if (width < 768) {
      // Phones anchor the popup directly above the chat bar at the bar's width.
      const bar = (await page.locator(".spec400-composer:visible").first().boundingBox())!;
      await expect.poll(async () => (await menu.boundingBox())?.width).toBeCloseTo(bar.width, 0);
      const above = (await menu.boundingBox())!;
      expect(above.y + above.height).toBeLessThanOrEqual(bar.y);
    } else await expect.poll(async () => (await menu.boundingBox())?.width).toBeCloseTo(282, 0);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue(draft);
    expect(
      await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});

test("tablet Settings remains inside the visible viewport when searching", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "tablet-768");
  await fixture(page, "dark", true, true);
  await page.goto("/?settings=appearance", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const field = settings.getByPlaceholder("Search settings");
  const close = settings.getByRole("button", { name: "Close settings", exact: true });
  await field.fill("appearance");
  await simulateKeyboard(page, 360, 24);
  await expectReachable(field, 24, 384);
  await expectReachable(close, 24, 384);
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toBeVisible();
  await close.click();
  await expect(settings).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute("data-kova-keyboard");
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: mobile chrome resize and live text scaling preserve the draft and controls`, async ({
    page,
  }, info) => {
    test.skip(!["phone-320", "phone-390", "landscape-844"].includes(info.project.name));
    const { width, height } = page.viewportSize()!;
    const portrait = height > width;
    const safe = portrait
      ? { top: 44, right: 0, bottom: 34, left: 0 }
      : { top: 0, right: 47, bottom: 21, left: 47 };
    await fixture(page, theme, true, true, "plus");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const html = page.locator("html");
    await html.evaluate((root, insets) => {
      for (const [edge, value] of Object.entries(insets)) {
        root.style.setProperty(`--safe-${edge}`, `${value}px`);
      }
    }, safe);
    const shell = page.locator('.kova-assistant[data-ui="modern"]');
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const send = page.getByRole("button", { name: "Send message", exact: true });
    const open = page.getByRole("button", { name: "Open menu", exact: true });
    const draft = "The same draft should survive browser controls and text size changes.";
    await input.fill(draft);
    await input.blur();
    const themeColor = page.locator('meta[name="theme-color"]');
    const color = (await themeColor.getAttribute("content"))!;
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    const background = await shell.evaluate((node) => getComputedStyle(node).backgroundColor);

    // Resize the browser before and after applying the value from the native text bridge.
    for (const [availableHeight, size] of [
      [height - 108, 32],
      [height, 32],
      [height, 16],
    ]) {
      await page.setViewportSize({ width, height: availableHeight });
      await html.evaluate((root, size) => {
        root.style.setProperty("--kova-native-font-size", `${size}px`);
      }, size);
      await expect(html).toHaveCSS("font-size", `${size}px`);
      await expect
        .poll(async () => (await shell.boundingBox())?.height)
        .toBeCloseTo(availableHeight, 0);
      await expect(shell).toHaveCSS("background-color", background);
      await expect(themeColor).toHaveAttribute("content", color);
      await expect(html).not.toHaveAttribute("data-kova-keyboard");
      await expect(input).toHaveValue(draft);
      await expectReachable(open, safe.top, availableHeight);
      await expectReachable(input, safe.top, availableHeight - safe.bottom);
      await expectReachable(send, safe.top, availableHeight - safe.bottom);
      expect(await html.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test(`${theme}: saved reading sizes reach the rendered answer after reload`, async ({ page }) => {
    await coreFixture(page, theme, "plus", { preserveStorageOnReload: true });
    for (const [label, size] of [
      ["Large", 18],
      ["Extra large", 20],
    ] as const) {
      await page.goto("/?settings=appearance", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await page.getByRole("combobox", { name: "Text size", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      const answer = page.locator(".kova-assistant-message .prose-chat").first();
      await expect(answer).toContainText("A practical release checklist");
      await expect(answer).toHaveCSS("font-size", `${size}px`);
      const paragraph = answer.locator("p").first();
      await expect(paragraph).toHaveCSS("font-size", `${size}px`);
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
  });

  for (const saved of [false, true]) {
    test(`${theme}: ${saved ? "conversation" : "home"} long draft and attachment remain reachable above a panned keyboard`, async ({
      page,
    }, info) => {
      const viewport = page.viewportSize()!;
      test.skip(viewport.width >= 768 && viewport.height > 500, "phone keyboard contract");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await fixture(page, theme, true, saved, "plus");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      await page.evaluate((portrait) => {
        const root = document.documentElement;
        root.style.setProperty("--safe-top", portrait ? "47px" : "0px");
        root.style.setProperty("--safe-left", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-right", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-bottom", portrait ? "34px" : "21px");
      }, viewport.height > viewport.width);
      const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
      const draft = Array.from(
        { length: 24 },
        (_, i) => `Line ${i + 1}: preserve this mobile draft.`,
      ).join("\n");
      await input.fill(draft);
      await page.getByLabel("Choose files", { exact: true }).setInputFiles([
        {
          name: "Mobile draft notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Synthetic mobile attachment, never uploaded to production."),
        },
        {
          name: "Mobile image.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=",
            "base64",
          ),
        },
      ]);
      await expect(page.getByLabel("Remove Mobile draft notes.txt", { exact: true })).toBeVisible();
      await input.focus();
      const height = viewport.height <= 500 ? 220 : 360;
      const top = viewport.height <= 500 ? 12 : 24;
      await simulateKeyboard(page, height, top);
      const shell = page.locator('.kova-assistant[data-ui="modern"]');
      await expect(shell).toHaveAttribute("data-keyboard-open", "true");
      await expect.poll(async () => (await shell.boundingBox())?.height).toBe(height);
      await expect(input).toHaveValue(draft);
      if (!saved) {
        const composer = (await page.locator(".spec400-composer").boundingBox())!;
        const keyboardGap = top + height - composer.y - composer.height;
        expect(keyboardGap).toBeGreaterThanOrEqual(8);
        expect(keyboardGap).toBeLessThanOrEqual(16);
      }
      await info.attach("keyboard-geometry", {
        body: JSON.stringify(
          await page.locator(".spec400-composer").evaluate((element) => ({
            composer: element.getBoundingClientRect().toJSON(),
            input: element.querySelector("textarea")?.getBoundingClientRect().toJSON(),
            toolbar: element
              .querySelector(".spec400-composer-toolbar")
              ?.getBoundingClientRect()
              .toJSON(),
          })),
          null,
          2,
        ),
        contentType: "application/json",
      });
      // The primary action must be immediately tappable while writing, without
      // making the user scroll the composer just to find Send.
      await expectReachable(
        page.getByRole("button", { name: "Send message", exact: true }),
        top,
        top + height,
      );
      await expectReachable(input, top, top + height);
      await expectReachable(
        page.getByRole("button", { name: "Expand input", exact: true }),
        top,
        top + height,
      );
      await expect(input).toHaveCSS("overflow-y", "auto");
      const imageChip = page.locator('.spec400-attachment-chip[data-kind="image"]');
      await expect(imageChip).toHaveCSS("height", "108px");
      await expect(imageChip).toHaveCSS("width", "108px");
      const removeImage = page.getByLabel("Remove Mobile image.png", { exact: true });
      await removeImage.scrollIntoViewIfNeeded();
      await expectReachable(removeImage, top, top + height);
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath("keyboard-long-draft.png") });
      expect(errors).toEqual([]);
    });
  }

  test(`${theme}: rotating an expanded draft preserves text, attachments, and dismissal`, async ({
    page,
  }, info) => {
    const viewport = page.viewportSize()!;
    test.skip(viewport.width >= 768 && viewport.height > 500, "phone rotation contract");
    await fixture(page, theme, true, false, "plus");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const draft = "An unsent draft that must survive rotation.\n".repeat(8);
    await input.fill(draft);
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Rotation notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic notes."),
    });
    const trigger = page.getByRole("button", { name: "Expand input", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Expand input", exact: true });
    const editor = dialog.getByRole("textbox", { name: "Message", exact: true });
    await expect(editor).toHaveValue(draft);
    const edited = `${draft}Added in the expanded editor.`;
    await editor.fill(edited);
    for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }, viewport]) {
      await page.setViewportSize(size);
      await page.evaluate((portrait) => {
        const root = document.documentElement;
        root.style.setProperty("--safe-top", portrait ? "47px" : "0px");
        root.style.setProperty("--safe-left", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-right", portrait ? "0px" : "47px");
        root.style.setProperty("--safe-bottom", portrait ? "34px" : "21px");
      }, size.height > size.width);
      await expect(editor).toHaveValue(edited);
      await expectReachable(
        dialog.getByRole("button", { name: "Close", exact: true }),
        0,
        size.height,
      );
      await expectReachable(
        dialog.getByRole("button", { name: "Collapse input", exact: true }),
        0,
        size.height,
      );
      expect(
        await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await editor.focus();
    await simulateKeyboard(page, 220, 12);
    await expectReachable(dialog.getByRole("button", { name: "Close", exact: true }), 12, 232);
    await expectReachable(
      dialog.getByRole("button", { name: "Collapse input", exact: true }),
      12,
      232,
    );
    await expectReachable(editor, 12, 232);
    await dialog.getByRole("button", { name: "Collapse input", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(edited);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel("Remove Rotation notes.txt", { exact: true })).toBeVisible();
    await trigger.click();
    await expect(editor).toHaveValue(edited);
    await editor.focus();
    await simulateKeyboard(page, 220, 12);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(edited);
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: info.outputPath("rotated-draft.png") });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: generated file and expanded activity stay contained on narrow screens`, async ({
    page,
  }) => {
    const filename = `${"long-generated-filename-".repeat(5)}.pdf`;
    const response = [
      "A document with **important information**.",
      `~~~pdf filename="${filename}"`,
      "Document body",
      "~~~",
    ].join("\n\n");
    await fixture(page, theme, true, true, "plus", {
      savedMessages: [
        {
          id: "ratio-generated-file",
          role: "assistant",
          content: response,
          workedMs: 2000,
          activities: [
            {
              activityId: "ratio-parent",
              tool: "github_search",
              label: "Reviewed a very long repository and document path",
              status: "done",
              at: 0,
            },
            {
              parentId: "ratio-parent",
              tool: "file_search",
              label: "Located document",
              detail: "unbroken-document-path-".repeat(8),
              count: 12345,
              total: 99999,
              status: "done",
              durationMs: 123456,
            },
          ],
        },
        {
          id: "ratio-interrupted-file",
          role: "assistant",
          content: '~~~pdf filename="unfinished-letter.pdf"\nPartial document',
          generationStatus: "failed",
        },
      ],
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const ready = page.locator('.kova-assistant-message .kova-file-card[data-state="ready"]');
    const failed = page.locator('.kova-file-card[data-state="interrupted"]');
    await expect(ready).toBeVisible();
    await expect(failed).toContainText("Generation interrupted. Retry the response.");
    await expect(failed.getByRole("button")).toBeDisabled();
    const group = page.locator(".kova-step-group").first();
    await expect(group).toHaveAttribute("open", "");
    await expect(group.getByText("Located document")).toBeVisible();
    const emphasis = page.locator(".kova-response-emphasis").first();
    await expect(emphasis).toBeVisible();
    expect(
      await emphasis.evaluate((element) => {
        const style = getComputedStyle(element);
        const parent = getComputedStyle(element.parentElement!);
        return style.color !== parent.color && style.fontWeight === parent.fontWeight;
      }),
    ).toBe(true);
    for (const selector of [
      ".kova-file-card",
      ".kova-file-card-open",
      ".kova-file-card-title",
      ".kova-file-card-meta",
      ".kova-step-group",
      ".kova-activity-row",
      ".kova-activity-progress",
    ]) {
      const boxes = await page.locator(selector).evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as HTMLElement;
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            viewport: document.documentElement.clientWidth,
            overflow: element.scrollWidth - element.clientWidth,
            verticalOverflow: element.scrollHeight - element.clientHeight,
          };
        }),
      );
      expect(boxes.length, selector).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.left, selector).toBeGreaterThanOrEqual(-1);
        expect(box.right, selector).toBeLessThanOrEqual(box.viewport + 1);
        expect(box.overflow, selector).toBeLessThanOrEqual(1);
        expect(box.verticalOverflow, selector).toBeLessThanOrEqual(1);
      }
    }
    const viewport = page.viewportSize()!;
    if (viewport.width < 480) {
      const download = ready.getByRole("button", { name: `Download ${filename}`, exact: true });
      await expect(download).toHaveCSS("opacity", "1");
      const box = (await download.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await group.locator("summary").click();
    await expect(group).not.toHaveAttribute("open", "");
    await group.locator("summary").click();
    await expect(group).toHaveAttribute("open", "");
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
}

test("mobile browser handoff fits its response and opens a contained workspace", async ({
  page,
}) => {
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 1024, "mobile and tablet browser handoff");
  await fixture(page, "dark", true, false, "plus");
  await page.route("**/api/chat", (route) => {
    const observedAt = Date.now();
    const sessionId = "99999999-9999-4999-8999-999999999999";
    const frame = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
    const body =
      frame({
        kind: "activity",
        activity_id: "ratio-browser-session",
        tool: "browser_interact",
        label: "Opened a browser session",
        status: "running",
        browser: {
          sessionId,
          tabCount: 1,
          observedAt,
          expiresAt: observedAt + 300000,
          hostname: `${"long-hostname-".repeat(4)}example.test`,
          previewPath: `/api/browser/preview/${sessionId}`,
        },
      }) +
      frame({ content: "The website needs your input." }) +
      "data: [DONE]\n\n";
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Message KovaGPT", exact: true }).fill("Open browser");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const card = page.locator(".kova-response-browser-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Open browser", { exact: true })).toBeVisible();
  const geometry = await card.evaluate((element) => {
    const root = element.getBoundingClientRect();
    return {
      left: root.left,
      right: root.right,
      viewport: document.documentElement.clientWidth,
      overflow: element.scrollWidth - element.clientWidth,
      children: Array.from(element.children).map((child) => {
        const box = child.getBoundingClientRect();
        return {
          left: box.left - root.left,
          right: root.right - box.right,
          top: box.top - root.top,
          bottom: root.bottom - box.bottom,
        };
      }),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const child of geometry.children) {
    for (const distance of Object.values(child)) expect(distance).toBeGreaterThanOrEqual(-1);
  }
  await card.click();
  const dialog = page.getByRole("dialog", { name: "Cloud browser", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Take over", exact: true })).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close browser workspace", exact: true });
  await expectReachable(close, 0, viewport.height);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();
});

test("a browser request without a URL keeps its address form within the chat", async ({ page }) => {
  await fixture(page, "dark", true, false, "plus");
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: "Include one public HTTPS link for Cloud Browser to open.",
        code: "cloud_browser_url_required",
        stage: "cloud_browser",
        retryable: false,
      },
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await page
    .getByRole("textbox", { name: "Message KovaGPT", exact: true })
    .fill("Open cloud browser");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const form = page.locator(".kova-browser-destination-form");
  await expect(form).toBeVisible();
  const input = form.getByRole("textbox", { name: "Website address" });
  const button = form.getByRole("button", { name: "Open browser", exact: true });
  await expect(button).toBeDisabled();
  await input.fill("https://example.com");
  await expect(button).toBeEnabled();
  const dimensions = await form.evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  expect(dimensions.pageOverflow).toBeLessThanOrEqual(1);
  const box = (await button.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
});

test("a generated blank PDF renders its real page without distorting the mobile preview", async ({
  page,
}) => {
  await fixture(page, "dark", true, true, "plus", {
    savedMessages: [
      {
        id: "ratio-blank-pdf",
        role: "assistant",
        content: 'Your file is ready.\n\n~~~pdf filename="blank-letter.pdf"\n~~~',
      },
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const card = page.locator('.kova-file-card[data-state="ready"]');
  await expect(card).toBeVisible();
  await card.locator(".kova-file-card-open").click();
  const pane = page.locator(".kova-file-pane");
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Page 1 of 1", { exact: true })).toBeVisible();
  const canvas = pane.locator("canvas");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  const dimensions = await canvas.evaluate((element) => {
    const bitmap = element as HTMLCanvasElement;
    const rect = bitmap.getBoundingClientRect();
    return {
      bitmapRatio: bitmap.width / bitmap.height,
      displayedRatio: rect.width / rect.height,
      left: rect.left,
      right: rect.right,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(dimensions.bitmapRatio).toBeCloseTo(612 / 792, 2);
  expect(dimensions.displayedRatio).toBeCloseTo(dimensions.bitmapRatio, 2);
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1);
  const close = pane.getByRole("button", { name: "Close preview", exact: true });
  await expectReachable(close, 0, page.viewportSize()!.height);
  await close.click();
  await expect(pane).toBeHidden();
});
