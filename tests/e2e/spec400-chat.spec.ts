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

async function expectRestingComposer(page: Page, composer = page.locator(".spec400-composer")) {
  const compactDesktop = await page.evaluate(
    () => matchMedia("(min-width: 1024px) and (pointer: fine)").matches,
  );
  const conversation = await composer.evaluate(
    (node) => node.closest('[data-composer-surface="conversation"]') !== null,
  );
  const compactEmpty =
    !conversation &&
    (await page.evaluate(
      () =>
        matchMedia("(width < 768px), (width < 1024px) and (height <= 500px) and (pointer: coarse)")
          .matches,
    ));
  await expect(composer).toHaveCSS("border-radius", compactEmpty ? "24px" : "34px");
  const singleRow = conversation && compactDesktop;
  await expect(composer).toHaveCSS("display", singleRow ? "grid" : "flex");
  const height = expect.poll(async () => (await composer.boundingBox())!.height);
  if (conversation) await height.toBeLessThanOrEqual(singleRow ? 62 : 92);
  else await height.toBeGreaterThanOrEqual(compactEmpty ? 92 : 128);
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
  await page.setViewportSize({ width: 1280, height: 400 });
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.locator("#chat-greeting")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare or manage Work" })).toHaveCount(0);
  const home = page.locator(".kova-empty-chat");
  await expect(home.getByRole("heading", { name: "Continue working", exact: true })).toBeVisible();
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
  await expect(topbar.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
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
    expect(await actions.count()).toBeGreaterThanOrEqual(3);
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

test("a composer link preview aligns with the first letter of the draft", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  const preview = page.locator(".kova-link-preview-composer");

  await input.fill("go to youtube.com");
  await expect(preview).toBeHidden();
  await input.press("End");
  await input.press("Space");
  await expect(preview).toBeVisible();

  await expect
    .poll(() =>
      input.evaluate((element) => {
        const link = element
          .closest(".spec400-composer")!
          .querySelector(".kova-link-preview-composer")!;
        const textStart =
          element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft);
        return Math.abs(link.getBoundingClientRect().left - textStart);
      }),
    )
    .toBeLessThan(0.5);
});

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
  await expect.poll(async () => (await notice.boundingBox())?.y).toBeCloseTo(16, 0);
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
