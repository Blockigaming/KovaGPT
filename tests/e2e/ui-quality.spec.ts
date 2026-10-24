import { expect, test, type Page } from "@playwright/test";

import { captureCandidateVisual } from "./candidate-visual-evidence";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-320x700", "phone-390x844", "tablet-1024x768", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

async function expectEmptyWorkspaceLandmarks(page: Page) {
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "What are you working on?", exact: true }),
  ).toBeVisible();
  // The mobile page title is a separate navigation destination heading.
  const navigationTitle = page.locator("[data-kova-navigation-heading]");
  await expect(navigationTitle).toHaveAttribute("role", "heading");
  await expect(navigationTitle).toHaveAttribute("aria-level", "1");
  await expect(navigationTitle).toHaveText("Chat");
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
  await expectEmptyWorkspaceLandmarks(page);
  await expect(composer).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
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
  expect(focused.outlineStyle).toBe("solid");
  expect(focused.outlineWidth).toBe(2);
  expect(focused.outlineOffset).toBe(2);
  expect(focused.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.outlineColor).not.toBe(focused.color);

  if (page.viewportSize()!.width >= 1024) {
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
        readingWidth: Number.parseFloat(
          getComputedStyle(element).getPropertyValue("--kova-reading-width"),
        ),
        input: bounds(".spec400-composer-input"),
        toolbar: bounds(".spec400-composer-toolbar"),
        attach: bounds('[aria-label="Attach"]'),
        send: bounds('[aria-label="Send message"]'),
      };
    });
    expect(metrics.width).toBeCloseTo(metrics.axisWidth, 1);
    expect(metrics.width).toBeLessThanOrEqual(metrics.readingWidth);
    expect(metrics.width).toBeGreaterThanOrEqual(640);
    expect(metrics.height).toBeGreaterThanOrEqual(160);
    expect(metrics.input!.height).toBeGreaterThanOrEqual(48);
    expect(metrics.input!.bottom).toBeLessThanOrEqual(metrics.toolbar!.y);
    expect(metrics.attach!.width).toBeGreaterThanOrEqual(44);
    expect(metrics.attach!.height).toBeGreaterThanOrEqual(44);
    expect(metrics.send!.width).toBe(44);
    expect(metrics.send!.height).toBe(44);
    expect(metrics.attach!.y).toBeCloseTo(metrics.send!.y, 1);

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
    expect((await fileAction.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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

  const starterLayout = await page.locator(".spec400-starter-actions").evaluate((grid) => {
    const style = getComputedStyle(grid);
    const visibleLabels = Array.from(grid.querySelectorAll(".spec400-toolbar-button > span"))
      .filter((label) => (label as HTMLElement).offsetParent !== null)
      .map((label) => ({ clientWidth: label.clientWidth, scrollWidth: label.scrollWidth }));
    return {
      display: style.display,
      flexWrap: style.flexWrap,
      justifyContent: style.justifyContent,
      visibleLabels,
    };
  });
  expect(starterLayout.display).toBe("flex");
  expect(starterLayout.flexWrap).toBe(page.viewportSize()!.width < 768 ? "wrap" : "nowrap");
  expect(starterLayout.justifyContent).toBe("flex-start");
  expect(starterLayout.visibleLabels).toHaveLength(3);
  for (const label of starterLayout.visibleLabels)
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
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
    expect(after.style).toBe("solid");
    expect(after.width).toBe(2);
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
    let rasterLogoRequests = 0;
    const rasterLogoResponses: boolean[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/kova-logo.png") {
        rasterLogoResponses.push(response.ok());
      }
    });
    await page.route("**/kova-logo.png*", (route) => {
      rasterLogoRequests += 1;
      return route.continue();
    });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("kova-theme-mode", selectedTheme);
      localStorage.setItem("kova-sidebar-open", "1");
    }, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const usesInter = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts).some(
        (face) => face.family.replaceAll('"', "") === "Inter" && face.status === "loaded",
      );
    });

    await expectEmptyWorkspaceLandmarks(page);
    const optionsTrigger = page.getByRole("button", { name: "Options", exact: true });
    await optionsTrigger.click();
    const responseOptions = page.getByRole("dialog", { name: "Response options", exact: true });
    await expect(responseOptions).toBeVisible();
    const effort = responseOptions.getByRole("region", { name: "Effort", exact: true });
    await expect(
      effort.getByText("Your Free plan uses its included setting. Thinking requires a paid plan.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      effort.getByRole("button", { name: "Thinking is locked. Open Subscriptions", exact: true }),
    ).toBeEnabled();
    await expect(effort.getByRole("combobox")).toHaveCount(0);
    await expect(effort.getByRole("button", { expanded: false })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(responseOptions).toBeHidden();
    await expect(optionsTrigger).toBeFocused();

    // Draft starters are lazy loaded and must focus/prefill without submitting
    // or overwriting work that is already present.
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const draftStarters = [
      { label: "Write something", prompt: "Help me write " },
      {
        label: "Summarize a file",
        prompt:
          "Summarize the file I attach, highlighting its key points and any important caveats.",
      },
      {
        label: "Compare options",
        prompt:
          "Compare these options, including their benefits, drawbacks, and important trade-offs:\n\n",
      },
    ];
    for (const { label, prompt } of draftStarters) {
      const starter = page.getByRole("button", { name: `Start with ${label}`, exact: true });
      await expect(starter).toBeVisible({ timeout: 15_000 });
      await input.clear();
      await starter.click();
      await expect(input).toHaveValue(prompt);
      await expect(input).toBeFocused();
      await expect(page.locator(".kova-user-message")).toHaveCount(0);
    }
    await input.fill("Keep my existing draft");
    await page.getByRole("button", { name: "Start with Write something", exact: true }).click();
    await expect(input).toHaveValue("Keep my existing draft");
    await expect(page.locator(".kova-user-message")).toHaveCount(0);
    await input.clear();
    await input.blur();
    // The shared owner asset belongs to the single sidebar brand. It is
    // decorative beside the visible name, with no duplicate greeting/fallback.
    const sidebarBrand = page.locator(".kova-sidebar-header .kova-sidebar-brand");
    await expect(sidebarBrand).toHaveCount(1);
    const brandLogo = sidebarBrand.locator("img.kova-logo");
    await expect(brandLogo).toHaveCount(1);
    await expect(brandLogo).toHaveAttribute("src", "/kova-logo.png");
    await expect(brandLogo).toHaveAttribute("alt", "");
    await expect(brandLogo).toHaveAttribute("aria-hidden", "true");
    await expect(brandLogo).toHaveAttribute("data-logo-variant", "standard");
    expect(await brandLogo.getAttribute("role")).toBeNull();
    expect(await brandLogo.getAttribute("aria-label")).toBeNull();
    await expect
      .poll(() =>
        brandLogo.evaluate((image: HTMLImageElement) =>
          Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
        ),
      )
      .toBe(true);
    await expect(sidebarBrand.locator("svg.kova-logo")).toHaveCount(0);
    await expect(page.locator(".kova-greeting-mark .kova-logo")).toHaveCount(0);
    if (page.viewportSize()!.width >= 1024) {
      await expect(page.getByRole("main")).toHaveAttribute("data-sidebar", "open");
      await expect(sidebarBrand).toBeVisible();
      await expect(sidebarBrand).toHaveText("KovaGPT");
    }
    expect(rasterLogoRequests).toBeGreaterThanOrEqual(1);
    expect(rasterLogoResponses.length).toBeGreaterThanOrEqual(1);
    expect(rasterLogoResponses.every(Boolean)).toBe(true);
    expect(hydrationErrors).toEqual([]);
    await expect(page).toHaveScreenshot(
      `guest-core-shell-${theme}-${usesInter ? "inter" : "fallback"}.png`,
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.005,
        scale: "css",
      },
    );
    await captureCandidateVisual(
      page,
      testInfo,
      `guest-core-shell-${theme}-${usesInter ? "inter" : "fallback"}`,
    );
    // The locked effort affordance leads to its real upgrade destination and
    // never masquerades as an available guest model selector.
    await optionsTrigger.click();
    await page
      .getByRole("dialog", { name: "Response options", exact: true })
      .getByRole("button", { name: "Thinking is locked. Open Subscriptions", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pricing(?:[?#]|$)/);
  });
}

test("mobile greeting and composer actions fit the viewport", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "What are you working on?", exact: true }),
  ).toBeVisible();

  const composer = page.locator(".spec400-composer");
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  for (const action of [
    page.getByRole("button", { name: "Open menu" }),
    page.getByRole("button", { name: "Attach", exact: true }),
    page.getByRole("button", { name: "Context", exact: true }),
    page.getByRole("button", { name: "Options", exact: true }),
    page.getByRole("button", { name: "Dictate", exact: true }),
    page.getByRole("button", { name: "Voice", exact: true }),
    page.getByRole("button", { name: "Send message" }),
  ]) {
    const actionBox = await action.first().boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.width).toBeGreaterThanOrEqual(44);
    expect(actionBox!.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Files", exact: true })).toBeVisible();
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
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(savedRow).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.getItem(localStorage.key(index) ?? ""),
        ).some((value) => value?.includes("Stability")),
      ),
    )
    .toBe(true);
  // A fresh load deliberately purges guest content. Durable authenticated
  // history is a separate acceptance path and is not claimed by this fixture.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expectEmptyWorkspaceLandmarks(page);
  await expect(page.locator(".kova-user-message, .kova-assistant-message")).toHaveCount(0);
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
  }
  await expect(savedRow).toHaveCount(0);
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
