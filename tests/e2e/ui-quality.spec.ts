import { expect, test } from "@playwright/test";

import { captureCandidateVisual } from "./candidate-visual-evidence";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-320x700", "phone-390x844", "tablet-1024x768", "desktop-1440x900"]);

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
      boxShadow: style.boxShadow,
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
      boxShadow: style.boxShadow,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focused.borderRadius).toBeGreaterThanOrEqual(16);
  expect(focused.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.outlineStyle).toBe("solid");
  expect(focused.outlineWidth).toBe(2);
  expect(focused.outlineOffset).toBe(1);
  expect(focused.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.outlineColor).not.toBe(focused.color);
  expect(unfocused.boxShadow).not.toBe("none");
  expect(focused.boxShadow).toBe(unfocused.boxShadow);

  if (page.viewportSize()!.width >= 1024) {
    const metrics = await composer.evaluate((element) => {
      const bounds = (selector: string) =>
        element.querySelector(selector)?.getBoundingClientRect() ?? null;
      const shell = element.getBoundingClientRect();
      const axis = element.parentElement?.getBoundingClientRect();
      return {
        shell: { width: shell.width, height: shell.height },
        axisWidth: axis?.width ?? 0,
        row: bounds(".kova-composer-row"),
        input: bounds(".kova-composer-input"),
        plus: bounds(".kova-attach-button"),
        send: bounds(".kova-send-button"),
      };
    });
    expect(metrics.shell.width).toBeCloseTo(metrics.axisWidth, 1);
    expect(metrics.shell.width).toBeLessThanOrEqual(768);
    expect(metrics.shell.width).toBeGreaterThanOrEqual(640);
    expect(metrics.shell.height).toBeGreaterThanOrEqual(60);
    expect(metrics.shell.height).toBeLessThanOrEqual(66);
    expect(metrics.row?.height).toBeGreaterThanOrEqual(60);
    expect(metrics.input?.height).toBeGreaterThanOrEqual(58);
    const coarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const expectedControlSize = coarsePointer ? 44 : 40;
    expect(metrics.plus?.width).toBe(expectedControlSize);
    expect(metrics.plus?.height).toBe(expectedControlSize);
    expect(metrics.send?.width).toBe(expectedControlSize);
    expect(metrics.send?.height).toBe(expectedControlSize);
    expect(metrics.plus?.y).toBe(metrics.send?.y);

    await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
    const menu = page.getByRole("dialog", { name: "Add files, tools, or prompts" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button", { name: "Start with Make a plan" })).toBeHidden();
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
    await expect(page.getByRole("button", { name: "Start with Make a plan" })).toBeVisible();
  }

  const starterLayout = await page.locator(".kova-starter-grid").evaluate((grid) => {
    const visibleLabels = Array.from(
      grid.querySelectorAll(".kova-starter-prompt > span:last-child"),
    )
      .filter((label) => (label as HTMLElement).offsetParent !== null)
      .map((label) => ({
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
      }));
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
      visibleLabels,
    };
  });
  expect(starterLayout.visibleLabels.length).toBeGreaterThan(0);
  for (const label of starterLayout.visibleLabels) {
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
  }
  if (page.viewportSize()!.width === 1024) expect(starterLayout.columns).toBe(2);
  if (page.viewportSize()!.width >= 1280) expect(starterLayout.columns).toBe(4);

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
    let rasterLogoRequests = 0;
    await page.route("**/kova-logo.png*", (route) => {
      rasterLogoRequests += 1;
      return route.abort();
    });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("kova-theme-mode", selectedTheme);
    }, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const usesInter = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts).some(
        (face) => face.family.replaceAll('"', "") === "Inter" && face.status === "loaded",
      );
    });

    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(".kova-model-static:visible")).toHaveCount(1);
    await expect(page.locator(".kova-model-static:visible svg")).toHaveCount(0);
    const greetingMark = page.locator(".kova-greeting-mark .kova-logo-mark");
    await expect(greetingMark).toBeVisible();
    await expect(greetingMark).toHaveAttribute("aria-hidden", "true");
    await expect(greetingMark).toHaveAttribute("data-logo-variant", "mark");
    expect(await greetingMark.getAttribute("role")).toBeNull();
    expect(await greetingMark.getAttribute("aria-label")).toBeNull();
    const greetingMarkStyle = await greetingMark.evaluate((element) => {
      const style = getComputedStyle(element);
      const parentStyle = getComputedStyle(element.parentElement!);
      const sample = (value: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = ([red, green, blue]: number[]) =>
        0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const foreground = luminance(sample(style.color));
      const background = luminance(sample(parentStyle.backgroundColor));
      return {
        color: style.color,
        surrounding: parentStyle.backgroundColor,
        contrast:
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        paths: element.querySelectorAll("circle, path").length,
      };
    });
    expect(greetingMarkStyle.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(greetingMarkStyle.color).not.toBe(greetingMarkStyle.surrounding);
    expect(greetingMarkStyle.contrast).toBeGreaterThanOrEqual(3);
    expect(greetingMarkStyle.paths).toBeGreaterThanOrEqual(2);
    if (page.viewportSize()!.width >= 1024) {
      const sidebarMark = page.locator(".kova-sidebar-header .kova-logo-mark:visible");
      await expect(sidebarMark).toHaveCount(1);
      await expect(sidebarMark).toBeVisible();
    }
    expect(rasterLogoRequests).toBe(0);
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
  await page.getByRole("button", { name: "Send" }).click();
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
    const action = page.getByRole("button", { name: "Copy", exact: true });
    const artifactAction = page.getByRole("button", { name: "Open code full screen" });
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
  await expect(page.locator(".kova-chat-row")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.getItem(localStorage.key(index) ?? ""),
        ).some((value) => value?.includes("Stability")),
      ),
    )
    .toBe(true);
});
