import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-320x700", "phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

test("empty workspace remains contained and composer focus is deliberate", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const composer = page.locator(".kova-composer").first();
  const input = page.getByRole("textbox", { name: "Message KovaGPT" }).first();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(composer).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" }).first()).toBeDisabled();

  const unfocused = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(unfocused.outlineStyle).toBe("none");
  expect(unfocused.outlineWidth).toBe(0);

  await input.focus();
  await input.fill("A focused prompt");
  await expect(page.getByRole("button", { name: "Send" }).first()).toBeEnabled();

  const focused = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: Number.parseFloat(style.borderRadius),
      borderColor: style.borderColor,
      shadow: style.boxShadow,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focused.borderRadius).toBeGreaterThanOrEqual(16);
  expect(focused.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.shadow).not.toBe("none");
  expect(focused.outlineStyle).toBe("solid");
  expect(focused.outlineWidth).toBe(2);
  expect(focused.outlineColor).not.toBe("rgba(0, 0, 0, 0)");

  if (page.viewportSize()!.width >= 1024) {
    const metrics = await composer.evaluate((element) => {
      const bounds = (selector: string) =>
        element.querySelector(selector)?.getBoundingClientRect() ?? null;
      const shell = element.getBoundingClientRect();
      return {
        shell: { width: shell.width, height: shell.height },
        row: bounds(".kova-composer-row"),
        input: bounds(".kova-composer-input"),
        plus: bounds(".kova-attach-button"),
        send: bounds(".kova-send-button"),
      };
    });
    expect(metrics.shell.width).toBe(768);
    expect(metrics.shell.height).toBeGreaterThanOrEqual(60);
    expect(metrics.shell.height).toBeLessThanOrEqual(66);
    expect(metrics.row?.height).toBeGreaterThanOrEqual(60);
    expect(metrics.input?.height).toBeGreaterThanOrEqual(58);
    expect(metrics.plus?.width).toBe(40);
    expect(metrics.plus?.height).toBe(40);
    expect(metrics.send?.width).toBe(40);
    expect(metrics.send?.height).toBe(40);
    expect(metrics.plus?.y).toBe(metrics.send?.y);

    await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
    const menu = page.getByRole("dialog", { name: "Add files, tools, or prompts" });
    await expect(menu).toBeVisible();
    const [menuBox, composerBox, headingBox] = await Promise.all([
      menu.boundingBox(),
      composer.boundingBox(),
      page.getByRole("heading", { level: 1 }).boundingBox(),
    ]);
    expect(menuBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(menuBox!.y).toBeGreaterThanOrEqual(composerBox!.y + composerBox!.height + 8);
    expect(menuBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height);
    const webSearchBox = await menu.getByRole("button", { name: "Search the web" }).boundingBox();
    expect(webSearchBox).not.toBeNull();
    expect(webSearchBox!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  }

  await input.clear();
  await page.getByRole("button", { name: "Start with Make a plan" }).click();
  await expect(input).toHaveValue("Create a practical step-by-step plan for ");
  await expect(input).toBeFocused();

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

    const composer = page.locator(".kova-composer").first();
    const input = page.getByRole("textbox", { name: "Message KovaGPT" }).first();
    const before = await composer.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, Number.parseFloat(style.outlineWidth)] as const;
    });
    expect(before).toEqual(["none", 0]);

    await input.focus();
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
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("kova-theme-mode", selectedTheme);
    }, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await page.addStyleTag({
      content: `html body, html button, html input, html textarea {
        font-family: Arial, sans-serif !important;
      }`,
    });
    await page.evaluate(() => document.fonts.ready);

    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(".kova-model-static:visible")).toHaveCount(1);
    await expect(page.locator(".kova-model-static:visible svg")).toHaveCount(0);
    expect(hydrationErrors).toEqual([]);
    await expect(page).toHaveScreenshot(`guest-core-shell-${theme}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
      scale: "css",
    });
  });
}

test("mobile greeting and composer actions fit the viewport", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByText("What can I help with?", { exact: true })).toBeVisible();

  const composer = page.locator(".kova-composer");
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  for (const action of [
    page.getByRole("button", { name: "Open menu" }),
    page.getByRole("button", { name: "Add files, tools, or prompts" }),
    page.getByRole("button", { name: "Send" }),
  ]) {
    const actionBox = await action.first().boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.width).toBeGreaterThanOrEqual(44);
    expect(actionBox!.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Search the web" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close sheet" }).click();
  await expect(sheet).toBeHidden();
});

test("unknown routes retain the themed shell state and semantic landmarks", async ({ page }) => {
  await page.goto("/definitely-not-a-real-kova-route", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "We couldn't find that page" }),
  ).toBeVisible();
  const home = page.getByRole("link", { name: "Return home" });
  await expect(home).toBeVisible();
  const homeBox = await home.boundingBox();
  expect(homeBox).not.toBeNull();
  expect(homeBox!.height).toBeGreaterThanOrEqual(44);
});
test("rich conversation rhythm and actions remain stable at every core viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "nova-gpt-conversations-v2",
      JSON.stringify([
        {
          id: "workspace-quality",
          title: "Workspace quality review with a title that truncates cleanly",
          mode: "instant",
          createdAt: now,
          updatedAt: now,
          messages: [
            { id: "user-quality", role: "user", content: "Explain the result clearly." },
            {
              id: "assistant-quality",
              role: "assistant",
              content:
                "## Result\n\nReadable copy with a [source](https://example.com).\n\n| Metric | Value |\n|---|---:|\n| Stability | 100 |\n\n```ts\nconst longValue = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz';\n```",
            },
          ],
        },
      ]),
    );
    localStorage.setItem("nova-gpt-pending-active", "workspace-quality");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator(".kova-user-message")).toBeVisible();
  await expect(page.locator(".kova-assistant-message")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const assistant = await page.locator(".kova-assistant-message").boundingBox();
  expect(assistant).not.toBeNull();
  expect(assistant!.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width, 820));

  if (page.viewportSize()!.width < 1024) {
    const action = page.getByRole("button", { name: "Copy", exact: true });
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    // Chromium can report an exact 44 CSS-pixel target a few millionths below 44
    // after device-scale rounding. Keep the WCAG target while tolerating only that noise.
    const subpixelTolerance = 0.01;
    expect(box!.width + subpixelTolerance).toBeGreaterThanOrEqual(44);
    expect(box!.height + subpixelTolerance).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await expect(page.locator(".kova-chat-row")).toBeVisible();
});
