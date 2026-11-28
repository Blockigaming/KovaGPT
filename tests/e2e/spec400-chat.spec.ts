import { expectsSeparateModeRow } from "./current-ui";
import {
  CLOUD_BROWSER_DAILY_LIMIT_DESCRIPTION,
  CLOUD_BROWSER_DAILY_LIMIT_MESSAGE,
  CLOUD_BROWSER_DAILY_LIMIT_TITLE,
  CLOUD_BROWSER_USAGE_HEADER,
} from "../../src/lib/chat-browser-policy.mjs";
import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { closeCurrentSettings, openResponseOptions, revealSidebar } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

test("composer stays in one pane on a spanned foldable", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium" || page.viewportSize()?.width !== 1440);
  await fixture(page, "dark", true, false, "pro");
  await page.goto("/");
  await waitForKovaHydration(page);
  const composer = page.locator('[data-composer-surface="empty"] .spec400-composer');
  const input = composer.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Review the attached image");
  await composer.locator('input[aria-label="Choose files"]').setInputFiles("public/kova-logo.png");
  await expect(composer.locator('li[data-status="complete"]')).toHaveCount(1);

  const session = await page.context().newCDPSession(page);
  for (const orientation of ["vertical", "horizontal"] as const) {
    const sideBySide = orientation === "vertical";
    const width = sideBySide ? 1114 : 720;
    const height = sideBySide ? 720 : 1114;
    const hinge = { orientation, offset: 540, maskLength: 34 };
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      screenWidth: width,
      screenHeight: height,
      deviceScaleFactor: 1,
      mobile: true,
      displayFeature: hinge,
      devicePosture: { type: "folded" },
    });
    await session.send("Emulation.setDisplayFeaturesOverride", { features: [hinge] });
    await expect
      .poll(async () => {
        const box = await composer.boundingBox();
        if (!box) return false;
        const start = sideBySide ? box.x : box.y;
        const end = start + (sideBySide ? box.width : box.height);
        return start >= hinge.offset + hinge.maskLength || end <= hinge.offset;
      })
      .toBe(true);
    await expect(composer.getByTestId("send-button")).toBeInViewport({ ratio: 1 });
  }
});

test("a short split window keeps Send visible with a full attachment tray", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440);
  await fixture(page, "dark", true, true, "pro");
  await page.goto("/");
  await waitForKovaHydration(page);
  const chat = page.locator('[data-composer-surface="conversation"]');
  if (!(await chat.isVisible())) {
    const sidebar = await revealSidebar(page);
    await sidebar.getByRole("button", { name: "Open chat Composer review chat" }).press("Enter");
  }
  await chat.getByRole("textbox", { name: "Message KovaGPT" }).fill("Review these images");
  await chat
    .locator('input[aria-label="Choose files"]')
    .setInputFiles(["public/kova-logo.png", "public/images/classroom-hero-restored-768.webp"]);
  await expect(chat.locator('li[data-status="complete"]')).toHaveCount(2);
  await page.setViewportSize({ width: 240, height: 320 });
  await expect(chat.getByTestId("send-button")).toBeInViewport({ ratio: 1 });
  await expect(chat.getByTestId("model-selector-trigger")).toBeInViewport({ ratio: 1 });
  await expect(chat.getByTestId("dictate-button")).toBeInViewport({ ratio: 1 });
});

async function expectRestingComposer(page: Page, composer = page.locator(".spec400-composer")) {
  const compactDesktop = await page.evaluate(() => matchMedia("(min-width: 1024px)").matches);
  const conversation = await composer.evaluate(
    (node) => node.closest('[data-composer-surface="conversation"]') !== null,
  );
  // Compact phone corners apply in the native app shell and on phone-width web.
  const phoneApp = await page.evaluate(() =>
    document.documentElement.dataset.kovaSurface === "app"
      ? matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
          .matches
      : matchMedia("(width < 768px)").matches,
  );
  await expect(composer).toHaveCSS(
    "border-radius",
    phoneApp ? (conversation ? "26px" : "21px") : "34px",
  );
  const singleRow = conversation && compactDesktop;
  await expect(composer).toHaveCSS("display", singleRow ? "grid" : "flex");
  const height = expect.poll(async () => (await composer.boundingBox())!.height);
  if (conversation)
    await height.toBeLessThanOrEqual(
      singleRow ? 62 : (await expectsSeparateModeRow(composer)) ? 144 : 100,
    );
  else await height.toBeGreaterThanOrEqual(phoneApp ? 88 : 128);
  const input = composer.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect.poll(async () => (await input.boundingBox())?.height).toBeGreaterThanOrEqual(26);
  if (singleRow) return compactDesktop;
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const input = node.querySelector("textarea")!.getBoundingClientRect();
        const toolbar = node.querySelector(".spec400-composer-toolbar")!.getBoundingClientRect();
        return input.bottom <= toolbar.top + 1;
      }),
    )
    .toBe(true);
  return compactDesktop;
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: empty composer, editable drafts, expand input and response preferences`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const send = page.getByTestId("send-button");
    const voice = page.getByTestId("voice-button");
    await expect(input).toBeEnabled();
    await expect(page.locator("#chat-greeting")).toBeVisible();
    await expect(page.locator("#chat-greeting")).not.toHaveText("");
    await expect(input).toHaveAttribute("placeholder", "Work with KovaGPT");
    await expectRestingComposer(page);
    await expect(send).toBeHidden();
    await expect(send).toBeDisabled();
    await expect(voice).toBeVisible();
    await expect(voice).toHaveAccessibleName("Voice");
    await expect(voice).toBeEnabled();
    await expect(page.getByText("Continue working", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Prepare or manage Work" })).toHaveCount(0);
    for (const action of ["Write something", "Summarize a file", "Compare options"]) {
      await expect(
        page.getByRole("button", { name: `Start with ${action}`, exact: true }),
      ).toHaveCount(0);
    }
    await input.fill("An editable draft");
    await expect(send).toBeVisible();
    await expect(voice).toBeHidden();
    await expect(page.locator("[data-chat-transcript]")).toHaveCount(0);
    await input.fill("Keep the original requirement.");
    const expand = page.getByRole("button", { name: "Expand input", exact: true });
    await input.press("Tab");
    await expect(expand).toBeFocused();
    await expand.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Expand input", exact: true });
    await expect(dialog).toBeVisible();
    const expandedInput = dialog.getByRole("textbox", { name: "Message", exact: true });
    await expect(expandedInput).toHaveValue("Keep the original requirement.");
    await expandedInput.fill("Keep the original requirement.\nAdd this detail.");
    await dialog.getByRole("button", { name: "Collapse input", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue("Keep the original requirement.\nAdd this detail.");
    await expect(expand).toBeFocused();
    const options = await openResponseOptions(page);
    await expect(options).toBeVisible();
    for (const [label, choice] of [
      ["Preferred response length", "Detailed"],
      ["Tone", "Formal"],
      ["Format", "Plain text"],
    ]) {
      const trigger = options.getByRole("combobox", { name: label, exact: true });
      await trigger.click();
      await page.getByRole("option", { name: choice, exact: true }).click();
      await expect(trigger).toContainText(choice);
      await expect(trigger).toBeFocused();
    }
    await closeCurrentSettings(page);
    await expect(input).toHaveValue("Keep the original requirement.\nAdd this detail.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`empty-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("signed-in homepage initially scrolls to the latest content", async ({ page }) => {
  test.skip(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "Recent work is desktop only",
  );
  await page.setViewportSize({ width: 1280, height: 400 });
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.locator("#chat-greeting")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare or manage Work" })).toHaveCount(0);
  const home = page.locator(".kova-empty-chat");
  await expect(home.getByRole("heading", { name: "Continue working", exact: true })).toBeVisible();
  const workspaceColor = await page
    .locator(".kova-chat-main")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(home.locator(".kova-composer-tray")).toHaveCSS("background-color", workspaceColor);
  await expect(home.locator(".kova-desktop-recent-work button").first()).toHaveCSS(
    "background-color",
    workspaceColor,
  );
  await expect
    .poll(() => home.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(8);
  await expect
    .poll(() =>
      home.evaluate((node) => Math.abs(node.scrollTop - (node.scrollHeight - node.clientHeight))),
    )
    .toBeLessThanOrEqual(2);
});

test("conversation composer keeps drafts and mobile Enter inserts a newline", async ({
  page,
}, info) => {
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const sidebar = await revealSidebar(page);
  await sidebar
    .getByRole("button", { name: "Open chat Composer review chat", exact: true })
    .press("Enter");
  const dock = page.locator(".spec400-composer-dock");
  const input = dock.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(input).toBeEnabled();
  const compactDesktop = await expectRestingComposer(page, dock.locator(".spec400-composer"));
  await input.fill("First line");
  await input.press(compactDesktop ? "Shift+Enter" : "Enter");
  await expect(input).toHaveValue("First line\n");
  await expect(dock.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const panel = page.locator(".kova-conversation-outputs");
  await expect(panel.getByText("Chat instructions and context", { exact: true })).toHaveCount(0);
  const panelHeight = await panel.evaluate((node) => node.offsetHeight);
  const addSource = panel.getByRole("button", { name: "Add source", exact: true });
  await addSource.click();
  const sourceMenu = page.locator('[aria-label="Add source options"]');
  await sourceMenu.getByRole("button", { name: "Connect plugins", exact: true }).click();
  const plugins = page.locator(".kova-activity-submenu[aria-label='Connect plugins']");
  await expect(plugins.getByRole("searchbox", { name: "Search plugins" })).toBeVisible();
  if (compactDesktop) {
    await expect(sourceMenu).toHaveClass(/kova-activity-floating/);
    await expect(plugins).toHaveClass(/kova-activity-floating/);
    expect(await panel.evaluate((node) => node.offsetHeight)).toBe(panelHeight);
    await page.keyboard.press("Escape");
    await expect(plugins).toBeHidden();
    await expect(sourceMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sourceMenu).toBeHidden();
    await expect(panel).toBeVisible();
  } else {
    await addSource.click();
  }
  await addSource.click();
  await sourceMenu.getByRole("button", { name: "Add from Library", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Add from Library", exact: true });
  await expect(library.getByPlaceholder("Search Library", { exact: true })).toBeVisible();
  await library.getByRole("button", { name: "Library options", exact: true }).click();
  const nameSort = page.getByRole("radio", { name: "Name", exact: true });
  await nameSort.check();
  await expect(nameSort).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(nameSort).toBeHidden();
  await library.getByRole("button", { name: "Close", exact: true }).click();
  await expect(library).toBeHidden();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await panel.getByRole("button", { name: "Create an output", exact: true }).first().click();
  const outputMenu = page.locator('[aria-label="Output types"]');
  if (compactDesktop) await expect(outputMenu).toHaveClass(/kova-activity-floating/);
  await expect(outputMenu.getByRole("button", { name: "Create site" })).toHaveCount(0);
  await outputMenu.getByRole("button", { name: "Create document", exact: true }).click();
  const templates = page.getByRole("region", { name: "document templates" });
  await expect(templates).toBeVisible();
  await expect(templates.locator(".kova-template-card")).toHaveCount(100);
  await expect(input).toHaveValue("First line\n");
  await templates.getByRole("button", { name: "Design Report", exact: true }).click();
  await expect(input).toHaveValue(/^First line\n\nCreate a document using the Design Report/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("conversation.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("landscape topbar keeps navigation and actions inside lateral safe areas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const topbar = page.locator('[data-ui-reference="chatgpt-mobile-topbar"]');
  const content = topbar.locator(".kova-topbar-inner");
  const title = topbar.locator("[data-kova-navigation-heading]");
  await expect(topbar).toBeVisible();
  await expect(title).toHaveText("KovaGPT");
  await expect(topbar.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
  // Home has no chat to leave: the temporary-chat hat is the last action.
  await expect(topbar.getByRole("button", { name: "New chat", exact: true })).toHaveCount(0);
  await expect(
    topbar.getByRole("button", { name: "Start temporary chat", exact: true }),
  ).toBeVisible();
  const original = await page.evaluate(() => {
    const root = document.documentElement;
    const properties = ["--safe-left", "--safe-right", "font-size"].map((name) => ({
      name,
      value: root.style.getPropertyValue(name),
      priority: root.style.getPropertyPriority(name),
    }));
    // Synthetic notch dimensions affect this test context only.
    root.style.setProperty("--safe-left", "31px");
    root.style.setProperty("--safe-right", "47px");
    return properties;
  });
  try {
    await expect(content).toHaveCSS("padding-left", "31px");
    await expect(content).toHaveCSS("padding-right", "47px");
    const headerBox = (await topbar.boundingBox())!;
    expect(headerBox.x).toBe(0);
    expect(headerBox.width).toBe(844);
    const insideSafeArea = (box: { x: number; width: number }) => {
      expect(box.x).toBeGreaterThanOrEqual(31);
      expect(box.x + box.width).toBeLessThanOrEqual(844 - 47);
    };
    for (const child of await content.locator(":scope > *").all()) {
      if (await child.isVisible()) insideSafeArea((await child.boundingBox())!);
    }
    const actions = topbar.getByRole("button").filter({ visible: true });
    expect(await actions.count()).toBeGreaterThanOrEqual(2);
    for (const action of await actions.all()) {
      const box = (await action.boundingBox())!;
      insideSafeArea(box);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(title).toBeVisible();
    insideSafeArea((await title.boundingBox())!);
    expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    // The original px-2 spacing scales with root text when there is no notch.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty("--safe-left", "0px");
      root.style.setProperty("--safe-right", "0px");
      root.style.setProperty("font-size", "32px");
    });
    await expect(content).toHaveCSS("padding-left", "16px");
    await expect(content).toHaveCSS("padding-right", "16px");
  } finally {
    await page.evaluate((properties) => {
      for (const { name, value, priority } of properties) {
        if (value) document.documentElement.style.setProperty(name, value, priority);
        else document.documentElement.style.removeProperty(name);
      }
    }, original);
  }
});

for (const surface of ["empty", "conversation"] as const) {
  test(`composer media previews wrap from the top left in ${surface} chat`, async ({ page }) => {
    await fixture(page, "dark", true, surface === "conversation");
    await page.goto("/");
    await waitForKovaHydration(page);
    const composer = page.locator(`[data-composer-surface="${surface}"] .spec400-composer`);
    if (surface === "conversation" && !(await composer.isVisible())) {
      const sidebar = await revealSidebar(page);
      await sidebar
        .getByRole("button", { name: "Open chat Composer review chat", exact: true })
        .press("Enter");
    }
    const input = composer.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    const tray = composer.getByRole("list", { name: "Attachments", exact: true });
    const photos = tray.locator(':scope > [data-kind="image"]');
    const cards = tray.locator(":scope > .spec400-composer-card");
    const websites = tray.locator(".kova-link-preview-composer");
    const expectStableToolbar = async () => {
      await expect
        .poll(() =>
          composer.evaluate((frame) => {
            const outer = frame.getBoundingClientRect();
            const actions = [
              frame.querySelector(".kova-composer-plus")!,
              frame.querySelector(
                ".spec400-composer-trailing :is(.kova-model-trigger, .kova-model-static, .kova-composer-model-status, .kova-thinking-toggle)",
              )!,
              frame.querySelector('[data-testid="dictate-button"]')!,
              frame.querySelector('[data-testid="send-button"]')!,
            ].map((node) => node.getBoundingClientRect());
            return actions.every(
              (a, i) =>
                a.left >= outer.left &&
                a.right <= outer.right &&
                a.top >= outer.top &&
                a.bottom <= outer.bottom &&
                actions
                  .slice(i + 1)
                  .every(
                    (b) =>
                      a.right <= b.left + 1 ||
                      b.right <= a.left + 1 ||
                      a.bottom <= b.top + 1 ||
                      b.bottom <= a.top + 1,
                  ),
            );
          }),
        )
        .toBe(true);
    };
    const pasteWebsites = (text: string) =>
      input.evaluate((element, text) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", text);
        element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
      }, text);
    const pasteAttachment = (name: string, type: string, data: string) =>
      input.evaluate(
        (element, { name, type, data }) => {
          const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
          const clipboardData = new DataTransfer();
          clipboardData.items.add(new File([bytes], name, { type }));
          element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
        },
        { name, type, data },
      );
    const photo =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=";

    await input.fill("go to youtube.com");
    await expect(tray).toBeHidden();
    await expectStableToolbar();
    await input.press("End");
    await input.press("Space");
    await expect(websites).toHaveCount(1);
    await pasteAttachment("Review notes.txt", "text/plain", "UmV2aWV3IG5vdGVz");
    await expect(cards.nth(0)).toHaveAttribute("data-status", "complete");
    await pasteAttachment(
      "Long filename for the second reference file.txt",
      "text/plain",
      "U2Vjb25k",
    );
    await expect(cards.nth(1)).toHaveAttribute("data-status", "complete");
    await expect
      .poll(() =>
        cards.evaluateAll((items) => {
          const [first, second, website] = items.map((item) => item.getBoundingClientRect());
          return {
            aligned: first.top === second.top && first.left < second.left,
            websiteFitsExpectedRow:
              items[0].parentElement!.clientWidth >= first.width * 3 + 16 - 0.5
                ? website.top === first.top && website.left > second.left
                : website.top > first.top && website.left === first.left,
            sameSize: [first, second, website].every(
              (card) => Math.abs(card.width - first.width) < 0.5 && card.height === 53,
            ),
          };
        }),
      )
      .toEqual({ aligned: true, websiteFitsExpectedRow: true, sameSize: true });
    await tray
      .getByRole("button", { name: "Remove Long filename for the second reference file.txt" })
      .click();
    await pasteAttachment("Pasted logo.png", "image/png", photo);
    await expect(
      photos.nth(0).getByRole("button", { name: "Inspect Pasted logo.png" }),
    ).toBeVisible();
    await expect(photos.nth(0)).toHaveAttribute("data-status", "complete");
    await expect(
      cards.nth(0).getByRole("button", { name: "Inspect Review notes.txt" }),
    ).toBeVisible();
    await expect(cards.nth(1).locator("[data-link-preview-url]")).toHaveAttribute(
      "data-link-preview-url",
      "https://youtube.com/",
    );
    const file = cards.nth(0);
    const normalColor = await websites
      .first()
      .evaluate((link) => getComputedStyle(link).backgroundColor);
    await expect(file).toHaveCSS("background-color", normalColor);
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
      const inspect = file.getByRole("button", { name: "Inspect Review notes.txt" });
      await inspect.hover();
      await expect(inspect).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const link = websites.first().getByRole("link");
      await link.hover();
      await expect(link).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    await expectStableToolbar();
    await expect
      .poll(() =>
        cards.evaluateAll((items) => {
          const strip = items[0].parentElement!;
          const photo = strip.firstElementChild!.getBoundingClientRect();
          const [file, website] = items.map((item) => item.getBoundingClientRect());
          const bothFit = photo.width + file.width + website.width + 24 <= strip.clientWidth + 0.5;
          return {
            fileBesidePhoto: file.top === photo.top && file.left > photo.left,
            websiteFitsExpectedRow: bothFit
              ? website.top === photo.top && website.left > file.left
              : website.top ===
                  file.bottom + parseFloat(getComputedStyle(items[0]).marginBlockEnd) &&
                website.left === file.left,
            sameWidth: file.width === website.width,
            bothFit,
          };
        }),
      )
      .toMatchObject({
        fileBesidePhoto: true,
        websiteFitsExpectedRow: true,
        sameWidth: true,
        ...(page.viewportSize()!.width === 430 || page.viewportSize()!.width >= 1280
          ? { bothFit: true }
          : {}),
      });
    await input.press("End");
    await pasteWebsites("https://github.com/review");
    await pasteWebsites("https://en.wikipedia.org/wiki/Kova");
    await expect(websites).toHaveCount(3);
    await expect(input).not.toHaveValue(/youtube|github|wikipedia/);
    await expect
      .poll(() =>
        cards.evaluateAll((items) => {
          const strip = items[0].parentElement!;
          const [first, ...rest] = items.map((item) => item.getBoundingClientRect());
          const photo = strip.firstElementChild!.getBoundingClientRect();
          const cardsBesidePhoto = Math.floor(
            (strip.clientWidth - photo.width - 8 + 0.5) / (first.width + 8),
          );
          const nextRow = rest[cardsBesidePhoto - 1];
          const rowGap = parseFloat(getComputedStyle(items[0]).marginBlockEnd);
          return {
            stacked: nextRow.top === first.bottom + rowGap && nextRow.left === first.left,
            photoBesideBothRows: nextRow.top < photo.bottom && nextRow.left >= photo.right + 8,
          };
        }),
      )
      .toEqual({ stacked: true, photoBesideBothRows: true });
    await tray.getByRole("button", { name: "Remove Review notes.txt" }).click();
    await pasteAttachment("Second photo.png", "image/png", photo);
    await expect(
      photos.nth(1).getByRole("button", { name: "Inspect Second photo.png" }),
    ).toBeVisible();

    const phone = await page.evaluate(
      () =>
        matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
          .matches,
    );
    if (phone) {
      await input.focus();
      await page.evaluate(() => {
        const visual = window.visualViewport!;
        const height = visual.height - 150;
        Object.defineProperty(visual, "height", { configurable: true, value: height });
        visual.dispatchEvent(new Event("resize"));
      });
      await expect(page.locator(".kova-assistant[data-ui=modern]")).toHaveAttribute(
        "data-keyboard-open",
        "true",
      );
      const plus = composer.getByRole("button", { name: "Attach", exact: true });
      await expect(plus).toHaveCSS("width", "44px");
      await expect(plus).toHaveCSS("height", "44px");
    }

    await pasteWebsites(
      Array.from({ length: 12 }, (_, index) => `https://example.org/page-${index}`).join(" "),
    );
    await expect(websites).toHaveCount(15);
    const desktop = await page.evaluate(() => matchMedia("(min-width: 1024px)").matches);
    const readLayout = () =>
      composer.evaluate((frame) => {
        const shell = frame.getBoundingClientRect();
        const field = frame.querySelector("textarea")!;
        const strip = frame.querySelector<HTMLElement>(".spec400-composer-media")!;
        const boxes = Array.from(
          strip.querySelectorAll(".spec400-attachment-chip, .spec400-composer-link"),
          (tile) => tile.getBoundingClientRect(),
        );
        const rows = [...new Set(boxes.map((box) => Math.round(box.top)))];
        const [first, second] = boxes;
        const links = boxes.slice(2);
        const linksPerRow = [...new Set(links.map((box) => box.top))].map(
          (top) => links.filter((box) => box.top === top).length,
        );
        const cardsPerFullRow = Math.floor((strip.clientWidth + 0.5) / (links[0].width + 8));
        const linksPerSideRow = Math.max(
          0,
          Math.floor(
            (strip.clientWidth - first.width - second.width - 16 + 0.5) / (links[0].width + 8),
          ),
        );
        const linksAfterPhotos = links.length - 2 * linksPerSideRow;
        const expectedLinksPerRow = [
          ...(linksPerSideRow ? [linksPerSideRow, linksPerSideRow] : []),
          ...Array.from({ length: Math.ceil(linksAfterPhotos / cardsPerFullRow) }, (_, index) =>
            Math.min(cardsPerFullRow, linksAfterPhotos - index * cardsPerFullRow),
          ),
        ];
        const stripBox = strip.getBoundingClientRect();
        return {
          inset: first.left - shell.left,
          topInset: first.top - shell.top,
          photosSideBySide: second.top === first.top && second.left > first.left,
          squarePhotos: [first, second].every((box) => Math.abs(box.width - box.height) < 0.5),
          linksFillFreeSpace:
            links.filter((link) => link.top < first.bottom).length === 2 * linksPerSideRow,
          linksWrapByAvailableSpace: linksPerRow.join() === expectedLinksPerRow.join(),
          cardsPerFullRow,
          gapBelowPhotos:
            (links.find((link) => link.top >= first.bottom)?.top ?? first.bottom) - first.bottom,
          promptGap: field.getBoundingClientRect().top - stripBox.bottom,
          promptStart: field.getBoundingClientRect().left - shell.left,
          rows: rows.length,
          rowsStartAtLeft: rows
            .filter((top) => top >= Math.round(first.bottom))
            .every(
              (top) =>
                Math.abs(boxes.find((box) => Math.round(box.top) === top)!.left - first.left) < 0.5,
            ),
          sidewaysOverflow: strip.scrollWidth > strip.clientWidth,
        };
      });
    await expect.poll(readLayout).toMatchObject({
      photosSideBySide: true,
      squarePhotos: true,
      linksFillFreeSpace: true,
      linksWrapByAvailableSpace: true,
      ...(page.viewportSize()!.width >= 1280 ? { cardsPerFullRow: 3 } : {}),
      rowsStartAtLeft: true,
      sidewaysOverflow: false,
    });
    const layout = await readLayout();
    expect(layout.inset).toBeGreaterThan(2);
    expect(layout.inset).toBeLessThan(layout.promptStart);
    expect(layout.topInset).toBeGreaterThan(2);
    expect(layout.promptGap).toBeGreaterThanOrEqual(8);
    expect(layout.rows).toBeGreaterThanOrEqual(phone && page.viewportSize()!.width < 768 ? 6 : 3);
    await expect(input).toBeInViewport();
    const send = composer.getByTestId("send-button");
    await expect(send).toBeInViewport();
    await expectStableToolbar();
    if (desktop) {
      expect(layout.gapBelowPhotos).toBeGreaterThanOrEqual(8);
      await expect(send).toHaveCSS("width", "36px");
      await expect(send).toHaveCSS("height", "36px");
      await expect
        .poll(() =>
          send.evaluate((button) => {
            const action = button.getBoundingClientRect();
            const arrow = button.querySelector("svg")!.getBoundingClientRect();
            const microphone = button
              .parentElement!.querySelector('[data-testid="dictate-button"]')!
              .getBoundingClientRect();
            const actionCenterY = action.top + action.height / 2;
            return Math.max(
              Math.abs(action.left + action.width / 2 - (arrow.left + arrow.width / 2)),
              Math.abs(actionCenterY - (arrow.top + arrow.height / 2)),
              Math.abs(actionCenterY - (microphone.top + microphone.height / 2)),
            );
          }),
        )
        .toBeLessThan(0.5);
    }

    const removeLink = tray
      .locator('[data-link-preview-url="https://github.com/review"]')
      .getByRole("button", { name: /^Remove linked page from message/ });
    if (phone) {
      await input.focus();
      await expect(input).toBeFocused();
      await removeLink.scrollIntoViewIfNeeded();
      const bounds = (await removeLink.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      try {
        await expect(input).toBeFocused();
      } finally {
        await page.mouse.up();
      }
    } else {
      await removeLink.click();
    }
    await expect(websites).toHaveCount(14);
    await expect(tray.locator('[data-link-preview-url="https://github.com/review"]')).toHaveCount(
      0,
    );
    await expect(
      tray.locator('[data-link-preview-url="https://en.wikipedia.org/wiki/Kova"]'),
    ).toHaveCount(1);
  });
}

test("Cloud Browser limit displays a top notification and keeps the sent Wikipedia icon compact", async ({
  page,
}) => {
  await fixture(page, "dark");
  const icon = "https://en.wikipedia.org/static/favicon/wikipedia.ico";
  const url = "https://en.wikipedia.org/wiki/The_Great_Wave_off_Kanagawa";
  await page.route(icon, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><text x="20" y="215" font-size="220">W</text></svg>',
    }),
  );
  await page.route("**/api/link-preview", (route) =>
    route.fulfill({ json: { url, title: "The Great Wave off Kanagawa", siteName: "Wikipedia" } }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error: CLOUD_BROWSER_DAILY_LIMIT_MESSAGE,
        code: "cloud_browser_daily_limit",
        stage: "cloud_browser",
        retryable: false,
      },
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill(`Open ${url} in Cloud Browser.`);
  const [response] = await Promise.all([
    page.waitForResponse((result) => new URL(result.url()).pathname === "/api/chat", {
      timeout: 12_000,
    }),
    page.getByTestId("send-button").click(),
  ]);
  expect(response.status()).toBe(429);
  const notice = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Cloud Browser limit reached" });
  await expect(notice).toBeVisible();
  await expect(notice.locator("[data-title]")).toHaveText(CLOUD_BROWSER_DAILY_LIMIT_TITLE);
  await expect(notice.locator("[data-description]")).toHaveText(
    CLOUD_BROWSER_DAILY_LIMIT_DESCRIPTION,
  );
  await expect(notice.locator("[data-action]")).toHaveCount(0);
  await expect(notice).toHaveAttribute("data-y-position", "top");
  const width = page.viewportSize()!.width;
  await expect(notice).toHaveAttribute("data-x-position", width >= 1024 ? "right" : "center");
  if (width < 768) {
    // Phones center the notice on screen; larger screens keep the top offset.
    const height = page.viewportSize()!.height;
    await expect
      .poll(async () => {
        const box = await notice.boundingBox();
        return box ? box.y + box.height / 2 : 0;
      })
      .toBeGreaterThan(height / 2 - 4);
    await expect
      .poll(async () => {
        const box = await notice.boundingBox();
        return box ? box.y + box.height / 2 : 0;
      })
      .toBeLessThan(height / 2 + 4);
  } else await expect.poll(async () => (await notice.boundingBox())?.y).toBeCloseTo(16, 0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const assistant = page.locator('[data-message-role="assistant"]');
  await expect(assistant).toHaveCount(1);
  await expect(
    assistant.getByText(CLOUD_BROWSER_DAILY_LIMIT_MESSAGE, { exact: true }),
  ).toBeVisible();
  await notice.getByRole("button", { name: "Close toast", exact: true }).click();
  await expect(notice).toBeHidden();
  const prompt = page.getByLabel("Sent prompt");
  await expect(prompt).toContainText("in Cloud Browser.");
  const favicon = prompt.locator("img");
  await expect(favicon).toHaveAttribute("src", icon);
  await expect.poll(() => favicon.evaluate((image) => image.naturalWidth)).toBe(256);
  await expect(favicon).toHaveCSS("width", "24px");
  await expect(favicon).toHaveCSS("height", "24px");
  await expect(input).toBeEmpty();
});

test("Kova usage exhaustion offers manual Cloud Browser without retrying generation", async ({
  page,
}) => {
  await fixture(page, "dark");
  const url = "https://example.com/";
  const sessionId = "d840146b-ab21-4a1a-8c68-9621ea1e11f2";
  const previewPath = `/api/browser/preview/${sessionId}`;
  const jpeg = (await page.screenshot({ type: "jpeg" })).toString("base64");
  const requests: string[] = [];
  await page.route("**/api/chat", (route) => {
    requests.push("chat");
    return route.fulfill({
      status: 429,
      headers: { [CLOUD_BROWSER_USAGE_HEADER]: "exhausted" },
      json: {
        error: "Your weekly regular message allowance is used.",
        code: "message_window_limit",
        category: "quota_exceeded",
        retryable: false,
      },
    });
  });
  await page.route("**/api/browser/open", (route) => {
    requests.push("manual");
    expect(route.request().postDataJSON()).toEqual({ url });
    return route.fulfill({
      json: {
        browser: { sessionId, tabCount: 1, observedAt: Date.now(), previewPath },
        frame: { id: sessionId, width: 390, height: 844, jpeg },
      },
    });
  });
  await page.route(`**${previewPath}`, (route) => {
    const command = route.request().postDataJSON();
    requests.push(command.kind);
    return route.fulfill({
      json: {
        frame: command.kind === "release" ? null : { id: sessionId, width: 390, height: 844, jpeg },
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill(`Open ${url} in Cloud Browser.`);
  await page.getByTestId("send-button").click();
  const notice = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Kova usage limit reached" });
  await expect(notice).toContainText("Your weekly regular message allowance is used.", {
    timeout: 12_000,
  });
  await expect(notice).toHaveAttribute("data-y-position", "top");
  expect(requests).toEqual(["chat"]);
  await notice.getByRole("button", { name: "Open Cloud Browser" }).click();
  const browser = page.getByRole("dialog", { name: "Cloud browser", exact: true });
  await expect(browser.getByRole("img", { name: "Live browser page" })).toBeVisible();
  await browser.getByRole("button", { name: "Close browser", exact: true }).click();
  await expect.poll(() => requests.includes("release")).toBe(true);
  expect(requests.filter((request) => request === "chat")).toEqual(["chat"]);
});
