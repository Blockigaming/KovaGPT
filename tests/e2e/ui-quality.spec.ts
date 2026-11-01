import { expect, test, type Page } from "@playwright/test";

import { installAuthenticatedFixture } from "./authenticated-fixture";
import { captureCandidateVisual } from "./candidate-visual-evidence";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";
import { waitForCommittedChat } from "./chat-history-commit";

const projects = new Set(["phone-320x700", "phone-390x844", "tablet-1024x768", "desktop-1440x900"]);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  if (!testInfo.title.startsWith("guest core shell visual baseline"))
    await installAuthenticatedFixture(page, {
      preserveStorageOnReload: testInfo.title.startsWith("rich conversation rhythm"),
    });
});

async function expectEmptyWorkspaceLandmarks(page: Page) {
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("#chat-greeting")).toBeVisible();
  await expect(page.locator("#chat-greeting")).not.toHaveText("");
  // The mobile page title is a separate navigation destination heading.
  const navigationTitle = page.locator("[data-kova-navigation-heading]");
  await expect(navigationTitle).toHaveAttribute("role", "heading");
  await expect(navigationTitle).toHaveAttribute("aria-level", "1");
  await expect(navigationTitle).toHaveText("KovaGPT");
  if (page.viewportSize()!.width < 1024) await expect(navigationTitle).toBeVisible();
  else await expect(navigationTitle).toBeHidden();
}

async function focusComposerByKeyboard(page: Page) {
  const composer = page.locator(".spec400-composer");
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.click();
  await expect(composer).toHaveAttribute("data-focus-origin", "pointer");
  await expect(composer).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Tab");
  await expect(composer).toHaveAttribute("data-focus-origin", "keyboard");
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
}

test("empty workspace remains contained and composer focus is deliberate", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".spec400-composer");
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const sidebarBrand = page.locator(".kova-sidebar-header .kova-sidebar-brand");
  await expect(sidebarBrand).toHaveText("KovaGPT");
  await expect(sidebarBrand.locator("img")).toHaveCount(1);
  const ownerAsset = await page.request.get("/kova-logo.png");
  expect(ownerAsset.ok()).toBe(true);
  expect(ownerAsset.headers()["content-type"]).toContain("image/png");
  expect((await ownerAsset.body()).byteLength).toBeGreaterThan(0);
  await expectEmptyWorkspaceLandmarks(page);
  await expect(composer).toBeVisible();
  const send = page.getByRole("button", { name: "Send message", exact: true, includeHidden: true });
  await expect(send).toBeHidden();
  await expect(send).toBeDisabled();
  await expect(page.getByRole("button", { name: "Voice", exact: true })).toBeVisible();
  const coarseComposer = await page.evaluate(
    () => innerWidth < 1024 || matchMedia("(any-pointer: coarse)").matches,
  );
  await expect(composer).toHaveCSS("outline-style", "none");

  await focusComposerByKeyboard(page);
  await input.fill("A focused prompt");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  const focused = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      radius: Number.parseFloat(style.borderRadius),
      radiusToken: Number.parseFloat(style.getPropertyValue("--kova-radius-composer")),
      borderColor: style.borderColor,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focused.radius).toBe(focused.radiusToken);
  expect(focused.radius).toBeGreaterThanOrEqual(16);
  expect(focused.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.outlineStyle).toBe("none");
  expect(focused.outlineWidth).toBe(0);
  expect(focused.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  await expect(input).toHaveCSS("outline-style", "none");

  {
    const metrics = await composer.evaluate((element) => {
      const bounds = (selector: string) => {
        const box = element.querySelector(selector)?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height, y: box.y, bottom: box.bottom } : null;
      };
      const shell = element.getBoundingClientRect();
      return {
        width: shell.width,
        height: shell.height,
        axisWidth: element.parentElement!.getBoundingClientRect().width,
        composerWidth: Number.parseFloat(
          getComputedStyle(element).getPropertyValue("--kova-composer-width"),
        ),
        input: bounds(".spec400-composer-input"),
        coarse: matchMedia("(any-pointer: coarse)").matches,
        attach: bounds('[aria-label="Attach"]'),
        send: bounds('[aria-label="Send message"]'),
      };
    });
    expect(metrics.width).toBeCloseTo(metrics.axisWidth, 1);
    expect(metrics.width).toBeLessThanOrEqual(metrics.composerWidth);
    if (page.viewportSize()!.width >= 1024) expect(metrics.width).toBeGreaterThanOrEqual(640);
    expect(metrics.height).toBeGreaterThanOrEqual(coarseComposer ? 136 : 148);
    expect(metrics.input!.height).toBeGreaterThanOrEqual(26);
    const control = coarseComposer ? 44 : 36;
    expect(metrics.attach!.width).toBe(control);
    expect(metrics.attach!.height).toBe(control);
    expect(metrics.send!.width).toBe(control);
    expect(metrics.send!.height).toBe(control);
    expect(metrics.attach!.y).toBeCloseTo(metrics.send!.y, 1);
    expect(metrics.input!.bottom).toBeLessThanOrEqual(metrics.attach!.y);
  }

  if (!coarseComposer) {
    const attach = page.getByRole("button", { name: "Attach", exact: true });
    await attach.click();
    const menu = page.getByRole("dialog", { name: "Attach files and tools", exact: true });
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start with Write something", exact: true }),
    ).toBeVisible();
    // Radix applies a short entrance transform. Wait for the real anchor gap,
    // rather than sampling an in-flight animation or widening its tolerance.
    await expect
      .poll(async () => {
        const [menuBox, anchorBox, side] = await Promise.all([
          menu.boundingBox(),
          attach.boundingBox(),
          menu.getAttribute("data-side"),
        ]);
        if (!menuBox || !anchorBox) return false;
        return side === "top"
          ? menuBox.y + menuBox.height <= anchorBox.y - 7
          : side === "bottom" && menuBox.y >= anchorBox.y + anchorBox.height + 7;
      })
      .toBe(true);
    const [menuBox, anchorBox] = await Promise.all([menu.boundingBox(), attach.boundingBox()]);
    expect(menuBox).not.toBeNull();
    expect(anchorBox).not.toBeNull();
    const side = await menu.getAttribute("data-side");
    expect(["top", "bottom"]).toContain(side);
    if (side === "top") expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(anchorBox!.y - 7);
    else expect(menuBox!.y).toBeGreaterThanOrEqual(anchorBox!.y + anchorBox!.height + 7);
    expect(menuBox!.x).toBeGreaterThanOrEqual(11);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 11);
    expect(menuBox!.y).toBeGreaterThanOrEqual(11);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 11);
    const fileAction = menu.getByRole("button", { name: "Photos & Files", exact: true });
    await expect(fileAction).toBeVisible();
    // The SDK entrance scales the entire menu. Measure the target after that
    // native animation has settled, preserving the 36px fine-pointer minimum.
    await expect
      .poll(async () => (await fileAction.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(36);
    // The allowance request can add Retry above Library after the menu opens.
    // Settle that real state before checking keyboard order; otherwise Home
    // correctly focuses Library while this live locator changes underneath it.
    await expect(menu.getByText(/Checking (today’s|your plan’s) upload allowance…/)).toBeHidden();
    const menuControls = menu.locator("button:not(:disabled),a[href]");
    await page.keyboard.press("Home");
    await expect(menuControls.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(menuControls.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menuControls.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(attach).toBeFocused();
  }

  const starterActions = page.locator(".spec400-starter-actions");
  await expect(starterActions.locator("strong, small, .kova-home-starter-arrow")).toHaveCount(0);
  await expect(page.locator(".kova-home-eyebrow")).toHaveCount(0);
  const starterLayout = await starterActions.evaluate((container) => {
    const style = getComputedStyle(container);
    const visibleLabels = Array.from(container.querySelectorAll(".kova-home-starter-copy"))
      .filter((label) => (label as HTMLElement).offsetParent !== null)
      .map((label) => {
        const box = label.getBoundingClientRect();
        const button = label.closest("button")!;
        const target = button.getBoundingClientRect();
        return {
          text: label.textContent?.trim(),
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          target: {
            left: target.left,
            right: target.right,
            top: target.top,
            bottom: target.bottom,
            width: target.width,
            height: target.height,
            radius: Number.parseFloat(getComputedStyle(button).borderTopLeftRadius),
          },
        };
      });
    return {
      display: style.display,
      flexDirection: style.flexDirection,
      alignItems: style.alignItems,
      gap: style.gap,
      visibleLabels,
    };
  });
  expect(starterLayout.display).toBe("flex");
  expect(starterLayout.flexDirection).toBe("column");
  expect(starterLayout.alignItems).toBe("stretch");
  expect(starterLayout.gap).toBe("0px");
  expect(starterLayout.visibleLabels).toHaveLength(3);
  expect(starterLayout.visibleLabels.map((label) => label.text)).toEqual([
    "Write something",
    "Summarize a file",
    "Compare options",
  ]);
  for (const label of starterLayout.visibleLabels) {
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    expect(label.left).toBeGreaterThanOrEqual(label.target.left);
    expect(label.right).toBeLessThanOrEqual(label.target.right);
    expect(label.top).toBeGreaterThanOrEqual(label.target.top);
    expect(label.bottom).toBeLessThanOrEqual(label.target.bottom);
    expect(label.target.width).toBeGreaterThanOrEqual(44);
    expect(label.target.height).toBeGreaterThanOrEqual(44);
    expect(label.target.height).toBeCloseTo(44, 1);
    expect(label.target.radius).toBe(10);
  }
  await input.clear();
  await page.getByRole("button", { name: "Start with Write something", exact: true }).click();
  await expect(input).toHaveValue("Help me write ");
  await expect(input).toBeFocused();
  await expect(page.locator(".kova-user-message")).toHaveCount(0);
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

for (const theme of ["light", "dark"] as const) {
  test(`composer focus contract remains visible in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("kova-theme-mode", selectedTheme);
    }, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);

    const composer = page.locator(".spec400-composer");
    const input = page.getByRole("textbox", { name: "Message KovaGPT" }).first();
    const before = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, Number.parseFloat(style.outlineWidth)] as const;
    });
    expect(before).toEqual(["none", 0]);

    await focusComposerByKeyboard(page);
    await expect(input).toBeFocused();
    const after = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.outlineColor,
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(after.style).toBe("none");
    expect(after.width).toBe(0);
    expect(after.color).not.toBe("rgba(0, 0, 0, 0)");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`guest core shell visual baseline in ${theme} mode`, async ({ page }, testInfo) => {
    test.skip(!new Set(["phone-390x844", "desktop-1440x900"]).has(testInfo.project.name));
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /(?:Minified React error #418|hydration failed|didn't match)/i.test(message.text())
      ) {
        hydrationErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (/(?:Minified React error #418|hydration failed|didn't match)/i.test(error.message)) {
        hydrationErrors.push(error.message);
      }
    });

    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("kova-theme-mode", selectedTheme);
      localStorage.setItem("kova-sidebar-open", "1");
    }, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("your next big thing.");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create an account", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(hydrationErrors).toEqual([]);
    await expect(page).toHaveScreenshot(`account-entry-${theme}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
      scale: "css",
    });
    await captureCandidateVisual(page, testInfo, `account-entry-${theme}`);
    await expect(page.locator('[data-testid="model-selector-trigger"]:visible')).toHaveCount(0);
  });
}

test("mobile greeting and composer actions fit the viewport", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator("#chat-greeting")).toBeVisible();
  await expect(page.locator("#chat-greeting")).not.toHaveText("");

  const composer = page.locator(".spec400-composer");
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  for (const action of [
    page.getByRole("button", { name: "Open menu" }),
    page.getByRole("button", { name: "Attach", exact: true }),
    page.getByRole("button", { name: "Dictate", exact: true }),
    page.getByRole("button", { name: "Voice", exact: true }),
  ]) {
    const actionBox = await action.first().boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.width).toBeGreaterThanOrEqual(44);
    expect(actionBox!.height).toBeGreaterThanOrEqual(44);
  }

  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(
    page.getByRole("button", { name: "Send message", includeHidden: true }),
  ).toBeHidden();
  await input.fill("Review a draft target");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeEnabled();
  const sendBox = (await send.boundingBox())!;
  expect(sendBox.width).toBe(44);
  expect(sendBox.height).toBe(44);
  await expect(page.getByRole("button", { name: "Voice", exact: true })).toBeHidden();
  await input.clear();

  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Context", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Response options", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Photos", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close sheet" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Attach", exact: true })).toBeFocused();
});

test("unknown routes retain the themed shell state and semantic landmarks", async ({ page }) => {
  await page.goto("/definitely-not-a-real-kova-route", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "This page isn’t available" }),
  ).toBeVisible();
  const home = page.getByRole("link", { name: "Go to chat", exact: true });
  await expect(home).toBeVisible();
  const homeBox = await home.boundingBox();
  expect(homeBox).not.toBeNull();
  expect(homeBox!.height).toBeGreaterThanOrEqual(44);
  await expect(home).toHaveAttribute("href", "/");
  await home.click();
  await waitForKovaHydration(page);
  await expectEmptyWorkspaceLandmarks(page);
});
test("rich conversation rhythm and actions remain stable at every core viewport", async ({
  page,
}) => {
  const richResponse =
    "## Result\n\nReadable copy with a [source](https://example.com).\n\n| Metric | Value |\n|---|---:|\n| Stability | 100 |\n\n```ts\nconst longValue = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz';\n```";
  let chatRequests = 0;
  let titleRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    expect(route.request().postDataJSON().messages.at(-1)?.content).toBe(
      "Explain the result clearly.",
    );
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: richResponse } }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.route("**/api/title", async (route) => {
    titleRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: "Workspace quality review" }),
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Explain the result clearly.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".kova-user-message")).toBeVisible();
  await expect(page.locator(".kova-assistant-message")).toBeVisible();
  const prompt = page.locator(".kova-user-message");
  const promptBox = (await prompt.boundingBox())!;
  const promptColumn = (await prompt
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' kova-message-reading-column ')][1]",
    )
    .boundingBox())!;
  // A short prompt should occupy only its content and sit at the end of the
  // reading column, leaving the assistant's reply a distinct visual turn.
  expect(promptBox.width).toBeLessThan(promptColumn.width);
  expect(promptBox.x + promptBox.width).toBeCloseTo(promptColumn.x + promptColumn.width, 0);
  const promptContrasts = await prompt.evaluate((element) => {
    const root = element.ownerDocument.documentElement;
    const wasDark = root.classList.contains("dark");
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    try {
      return [false, true].map((dark) => {
        root.classList.toggle("dark", dark);
        const style = getComputedStyle(element);
        const values = [luminance(style.color), luminance(style.backgroundColor)];
        return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      });
    } finally {
      root.classList.toggle("dark", wasDark);
    }
  });
  for (const contrast of promptContrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".kova-assistant-message")).toContainText("Stability");
  await expect(page.locator(".kova-assistant-message table")).toBeVisible();
  await expect(page.locator(".kova-assistant-message pre code")).toBeVisible();
  await expect(
    page.locator(".kova-assistant-message").getByRole("link", { name: "source" }),
  ).toBeVisible();
  await expect.poll(() => chatRequests).toBe(1);
  await expect.poll(() => titleRequests).toBe(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const assistant = await page.locator(".kova-assistant-message").boundingBox();
  expect(assistant).not.toBeNull();
  expect(assistant!.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width, 820));

  if (page.viewportSize()!.width < 1024) {
    for (const label of ["Edit message", "Branch from this message in a new chat"]) {
      const promptAction = page.getByRole("button", { name: label, exact: true });
      await expect(promptAction).toBeVisible();
      const promptActionBox = (await promptAction.boundingBox())!;
      expect(promptActionBox.width + 0.01).toBeGreaterThanOrEqual(44);
      expect(promptActionBox.height + 0.01).toBeGreaterThanOrEqual(44);
    }
    const action = page.getByRole("button", { name: "Copy response", exact: true });
    const artifactAction = page.getByRole("button", { name: "Open code result", exact: true });
    await expect(action).toBeVisible();
    await expect(artifactAction).toBeVisible();
    const box = await action.boundingBox();
    const artifactBox = await artifactAction.boundingBox();
    expect(box).not.toBeNull();
    expect(artifactBox).not.toBeNull();
    // Chromium can report an exact 44 CSS-pixel target a few millionths below 44
    // after device-scale rounding. Keep the WCAG target while tolerating only that noise.
    const subpixelTolerance = 0.01;
    expect(box!.width + subpixelTolerance).toBeGreaterThanOrEqual(44);
    expect(box!.height + subpixelTolerance).toBeGreaterThanOrEqual(44);
    expect(artifactBox!.width).toBeGreaterThan(70);
    expect(artifactBox!.height + subpixelTolerance).toBeGreaterThanOrEqual(44);
    expect(artifactBox!.height).toBeLessThanOrEqual(48);
    expect(await artifactAction.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe(
      "nowrap",
    );
  }
  const savedRow = page.locator(".kova-chat-row");
  await revealSidebar(page);
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow).toContainText("Workspace quality review");
  // A returning account retains this local conversation across navigation.
  // Unscoped guest and legacy stores must remain empty.
  await waitForCommittedChat(page, "Stability", "Workspace quality review");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await revealSidebar(page);
  await expect(savedRow).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open chat Workspace quality review", exact: true })
    .click();
  await expect(page.locator(".kova-assistant-message")).toContainText("Stability");
  const guestStorage = await page.evaluate(() => ({
    conversations: JSON.parse(localStorage.getItem("nova-gpt-conversations-v3:guest") ?? "[]"),
    pendingActive: localStorage.getItem("nova-gpt-pending-active:v2:guest"),
    legacy: ["nova-gpt-conversations-v2", "kovagpt:archived", "nova-gpt-pending-active"].map(
      (key) => localStorage.getItem(key),
    ),
    containsPriorContent: Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index) ?? ""),
    ).some((value) => value?.includes("Stability") || value?.includes("Workspace quality review")),
  }));
  expect(guestStorage.conversations).toEqual([]);
  expect(guestStorage.pendingActive).toBeNull();
  expect(guestStorage.legacy).toEqual([null, null, null]);
  expect(guestStorage.containsPriorContent).toBe(false);
  expect(chatRequests).toBe(1);
  expect(titleRequests).toBe(1);
});
