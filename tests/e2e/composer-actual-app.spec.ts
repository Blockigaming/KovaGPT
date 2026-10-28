import { expect, test, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";
import { coreFixture } from "./core-app-fixture";
import { openResponseOptions, revealSidebar } from "./current-ui";
import { fixture, origin, functionNames } from "./actual-app-fixture";

async function geometry(page: Page) {
  const composer = page.locator(".spec400-composer");
  await expect(composer).toHaveCSS("border-radius", "28px");
  for (const name of ["Attach", "Send message"]) {
    const button = composer.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  // Read both bounds in one layout and wait for textarea/font resizing to settle.
  await expect
    .poll(() =>
      composer.evaluate((node) => {
        const input = node.querySelector("textarea")!.getBoundingClientRect();
        const attach = node.querySelector('[aria-label="Attach"]')!.getBoundingClientRect();
        return input.bottom - attach.top;
      }),
    )
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("guest Add menu uses one scroll region in a short desktop viewport", async ({
  page,
}, info) => {
  test.skip(page.viewportSize()!.width < 768, "Desktop Popover regression; phones use a sheet.");
  await page.setViewportSize({ width: 1180, height: 757 });
  await fixture(page, "dark", false);
  await page.goto("/");
  await waitForKovaHydration(page);
  const trigger = page.getByRole("button", { name: "Attach", exact: true });
  const menu = page.getByRole("dialog", { name: "Attach files and tools", exact: true });
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Keep this guest draft");

  for (let opening = 0; opening < 2; opening++) {
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("data-side", /^(top|bottom)$/);
    const box = await menu.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(12);
    expect(box!.y + box!.height).toBeLessThanOrEqual(745);
    expect(
      await menu.evaluate((element) =>
        [element, ...element.querySelectorAll<HTMLElement>("*")]
          .filter(
            (node) =>
              /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) &&
              node.scrollHeight > node.clientHeight + 1,
          )
          .map((node) => node === element),
      ),
    ).toEqual([true]);
    for (const name of ["Library", "Photos & Files", "Drawings", "Create Image"])
      await expect(menu.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });

    await page.keyboard.press("End");
    const browse = menu.getByRole("link", { name: "Browse all plugins", exact: true });
    await expect(browse).toBeFocused();
    await expect(browse).toBeInViewport({ ratio: 1 });
    const drive = menu.getByRole("button", { name: /^Google Drive / });
    await drive.focus();
    await expect(drive).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Home");
    await expect(menu.getByRole("button", { name: "Library", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue("Keep this guest draft");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: empty composer, menus, files and focus`, async ({ page }, info) => {
    await fixture(page, theme);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(input).toBeEnabled();
    await geometry(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: info.outputPath(`home-empty-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await input.click();
    await expect(page.locator(".spec400-composer")).toHaveCSS("outline-style", "none");
    await page.getByRole("button", { name: "Expand input", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();
    await expect(page.locator(".spec400-composer")).toHaveCSS("outline-offset", "2px");
    await input.fill("Plan a thoughtful product launch");
    await input.press("Shift+Enter");
    await input.pressSequentially("Keep the next steps clear.");
    await expect(input).toHaveValue("Plan a thoughtful product launch\nKeep the next steps clear.");
    await page.screenshot({
      path: info.outputPath(`home-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    const menu = page.getByRole("dialog", {
      name: /^(Attach files and tools|Attach to your message|Attach)$/,
    });
    await expect(menu).toBeVisible();
    if (page.viewportSize()!.width < 768) {
      for (const name of ["Photos", "Camera", "Files", "Library"])
        await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await page.screenshot({
      path: info.outputPath(`add-menu-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Draft notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic draft attachment."),
    });
    await expect(page.getByLabel("Remove Draft notes.txt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Context", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Context", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByText("Draft notes.txt", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Context", exact: true })).toBeFocused();
    await expect(input).toHaveValue(/Plan a thoughtful product launch/);
  });

  test(`${theme}: saved conversation preserves edit drafts and clipboard fallback`, async ({
    page,
  }, info) => {
    await fixture(page, theme, true, true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();
    await geometry(page);
    await input.fill("My unsent follow-up");
    await page.getByLabel("Choose files", { exact: true }).setInputFiles({
      name: "Keep.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep this local draft."),
    });
    await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit message", exact: true }).click();
    await expect(input).toHaveValue("Draft a release checklist.");
    await input.fill("A revised prompt");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(input).toHaveValue("My unsent follow-up");
    await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`conversation-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    if (page.viewportSize()!.width >= 1024) {
      await revealSidebar(page);
      await page.getByRole("button", { name: "Edit message", exact: true }).click();
      await page.getByRole("button", { name: "Open chat Second review chat", exact: true }).click();
      await expect(input).toHaveValue("Second chat draft");
      await expect(page.getByText("Editing a previous prompt", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toHaveCount(0);
      await page
        .getByRole("button", { name: "Open chat Composer review chat", exact: true })
        .click();
      await expect(input).toHaveValue("My unsent follow-up");
      await expect(page.getByLabel("Remove Keep.txt", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Copy response", exact: true }).first().click();
    const copy = page.getByRole("dialog", { name: "Copy response", exact: true });
    await expect(copy).toBeVisible();
    await expect(copy.getByRole("textbox", { name: "Response text to copy" })).toBeFocused();
    await expect(copy.getByRole("textbox", { name: "Response text to copy" })).toHaveValue(
      /A practical release checklist/,
    );
    await copy.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Copy response", exact: true }).first(),
    ).toBeFocused();
  });
}

test("v11 shared controls preserve chat data and return focus", async ({ page }, info) => {
  await coreFixture(page, "dark");
  const copied: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!functionNames.get(id)?.startsWith("importChatToProject_")) return route.fallback();
    copied.push(route.request().postData() ?? "");
    return route.fulfill({
      json: { result: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, context: {} },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Keep this unsent draft");
  await revealSidebar(page);
  if (await page.getByRole("navigation", { name: "Primary navigation", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Open chat Composer review chat", exact: true }).hover();
  }
  await page.getByRole("button", { name: "Options for Composer review chat", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add to project", exact: true }).click();
  const projectDialog = page.getByRole("dialog", { name: "Add to project", exact: true });
  await expect(
    projectDialog.getByRole("button", { name: "Add to project", exact: true }),
  ).toBeDisabled();
  await projectDialog
    .getByLabel("Project", { exact: true })
    .selectOption("33333333-3333-4333-8333-333333333333");
  await projectDialog.getByRole("button", { name: "Add to project", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chat added", exact: true })).toBeVisible();
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain("Draft a release checklist.");
  expect(copied[0]).not.toContain("Keep this unsent draft");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(input).toHaveValue("Keep this unsent draft");
  await expect(page.getByText("Draft a release checklist.", { exact: true })).toBeVisible();

  await page.goto("/");
  await waitForKovaHydration(page);
  // The fixture restores its closed sidebar preference on every navigation.
  const navigation = await revealSidebar(page);
  await navigation.getByRole("button", { name: "New chat", exact: true }).click();
  await input.fill("Keep this unsent draft");
  const temporary = page.getByRole("button", { name: "Start temporary chat", exact: true });
  await temporary.click();
  await expect(
    page.getByRole("dialog", { name: "Start a temporary chat", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(temporary).toBeFocused();
  await expect(input).toHaveValue("Keep this unsent draft");

  await page.goto("/projects/33333333-3333-4333-8333-333333333333");
  await waitForKovaHydration(page);
  await page
    .getByRole("combobox", { name: "More project tools", exact: true })
    .selectOption("timers");
  const timer = page.getByRole("button", { name: "Timers", exact: true });
  await timer.click();
  const timerPanel = page.getByRole("region", { name: "Timer controls", exact: true });
  await expect(timerPanel).toBeVisible();
  const panelBox = await timerPanel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(timerPanel).toBeHidden();
  await expect(timer).toBeFocused();
});

test("guest gates keep drafts and send reaches the actual request path", async ({ page }) => {
  await fixture(page, "light", false);
  let requests = 0;
  await page.route("**/api/chat", (route) => {
    requests++;
    return route.fulfill({
      status: 503,
      json: {
        error: "Provider unavailable",
        category: "model_provider_failure",
        retryable: false,
        requestId: "composer-local-test",
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(input).toBeEnabled();
  await input.fill("Keep this guest draft");
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page
    .getByRole("dialog", { name: /^(Attach files and tools|Attach to your message|Attach)$/ })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  const prompt = page.getByRole("dialog", { name: "Sign in to continue" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(input).toHaveValue("Keep this guest draft");
  await page.getByTestId("send-button").click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByText(/Provider unavailable|AI provider had a hiccup/).first(),
  ).toBeVisible();
});

test("voice stays disconnected while typing, attachments and Stop retain their contracts", async ({
  page,
}, info) => {
  await fixture(page, "dark");
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        document.documentElement.dataset.unexpectedMicrophoneRequest = "true";
        return Promise.reject(new Error("Microphone access is forbidden in this UI test"));
      },
    });
  });
  let requests = 0;
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    requests++;
    await pendingResponse;
    await route.fulfill({ status: 503, json: { error: "Local fixture stopped" } }).catch(() => {});
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  const voice = page.getByRole("button", { name: "Dictate", exact: true });
  await expect(input).toBeEnabled();
  await expect(voice).toBeEnabled();
  await expect(page.getByTestId("send-button")).toBeDisabled();
  await geometry(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath("voice-empty-dark.png"), animations: "disabled" });
  await voice.click();
  const dialog = page.getByRole("dialog", { name: "Dictate", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Voice is not available yet");
  await page.screenshot({
    path: info.outputPath("voice-not-connected.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(voice).toBeFocused();
  expect(requests).toBe(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-microphone-request");

  await input.fill(" ");
  await expect(voice).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeDisabled();
  await input.fill("A typed draft");
  await expect(page.getByTestId("send-button")).toBeEnabled();
  await expect(input).toBeFocused();
  await input.dispatchEvent("compositionstart", { data: "あ" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(input).toHaveValue("A typed draft");
  expect(requests).toBe(0);
  await input.dispatchEvent("compositionend", { data: "あ" });
  await page.screenshot({
    path: info.outputPath("voice-switched-to-send.png"),
    animations: "disabled",
  });
  await input.fill("");
  await expect(voice).toBeVisible();
  await expect(input).toBeFocused();

  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "Voice test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic attachment-only message."),
  });
  await expect(page.getByLabel("Remove Voice test.txt", { exact: true })).toBeVisible();
  await expect(voice).toBeVisible();
  await expect(page.getByTestId("send-button")).toBeEnabled();
  await page.getByTestId("send-button").click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await expect(voice).toBeDisabled();
  await expect(page.getByTestId("send-button")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  releaseResponse();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(voice).toBeVisible();
  await geometry(page);

  await openResponseOptions(page);
  const upgrade = page.getByRole("button", {
    name: "Thinking is locked. Open Subscriptions",
    exact: true,
  });
  await upgrade.click();
  await expect(page.locator(".kova-settings-dialog .kova-billing-details")).toBeVisible();
  await expect(page).toHaveURL(`${origin}/settings/billing`);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Free composer uses quiet pointer focus and locked Thinking opens Subscriptions`, async ({
    page,
  }, info) => {
    await fixture(page, theme);
    await page.goto("/");
    await waitForKovaHydration(page);
    const input = page.getByRole("textbox", { name: "Message KovaGPT" });
    const composer = page.locator(".spec400-composer");
    const thinking = page.getByTestId("thinking-upgrade-button");
    await expect(input).toBeEnabled();
    await expect(page.getByRole("button", { name: "Model availability", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    const restingBorder = await composer.evaluate((node) => getComputedStyle(node).borderColor);
    const restingShadow = await composer.evaluate((node) => getComputedStyle(node).boxShadow);
    await input.click();
    await expect(composer).toHaveAttribute("data-focus-origin", "pointer");
    await expect(composer).toHaveCSS("border-color", restingBorder);
    await expect(composer).toHaveCSS("outline-style", "none");
    await expect(composer).toHaveCSS("box-shadow", restingShadow);
    await input.fill("Keep this draft while checking my plan");
    await openResponseOptions(page);
    await expect(thinking.getByText("Thinking", { exact: true })).toBeVisible();
    await expect(thinking.locator("svg.lucide-lock")).toBeVisible();
    await expect(thinking).toHaveAttribute("aria-label", "Thinking is locked. Open Subscriptions");
    await geometry(page);
    await page.screenshot({
      path: info.outputPath(`free-pointer-${theme}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("dialog", { name: "Response options", exact: true })
      .getByRole("combobox", { name: "Format", exact: true })
      .focus();
    for (let index = 0; index < 3; index++) await page.keyboard.press("Tab");
    await expect(thinking).toBeFocused();
    await expect(thinking).toHaveCSS("outline-style", "solid");
    await page.screenshot({
      path: info.outputPath(`free-keyboard-${theme}.png`),
      animations: "disabled",
    });
    await thinking.click();
    const settings = page.locator(".kova-settings-dialog");
    await expect(settings.locator(".kova-billing-details")).toBeVisible();
    await expect(page).toHaveURL(`${origin}/settings/billing`);
    await page.screenshot({
      path: info.outputPath(`thinking-subscriptions-${theme}.png`),
      animations: "disabled",
    });
    await page.goBack();
    await waitForKovaHydration(page);
    await expect(input).toHaveValue("Keep this draft while checking my plan");
    await input.click();
    await expect(composer).toHaveCSS("border-color", restingBorder);
    await expect(composer).toHaveCSS("outline-style", "none");
  });
}

for (const tier of ["plus", "pro"] as const) {
  test(`${tier}: paid model selection remains available`, async ({ page }, info) => {
    await fixture(page, "dark", true, false, tier);
    await page.goto("/");
    await waitForKovaHydration(page);
    await expect(page.getByTestId("thinking-upgrade-button")).toHaveCount(0);
    await openResponseOptions(page);
    const picker = page.getByTestId("model-selector-trigger").filter({ visible: true });
    await expect(picker).toBeVisible();
    await picker.click();
    await expect(page.getByTestId("model-option-high")).toHaveText(
      tier === "plus" ? "Thinking" : "High",
    );
    await expect(page.getByTestId("model-option-ultra")).toHaveCount(tier === "pro" ? 1 : 0);
    await page.getByTestId("model-option-high").click();
    await expect(picker).toHaveAttribute(
      "aria-label",
      `Choose model: Kova GPT ${tier === "plus" ? "Thinking" : "High"}`,
    );
    await expect(picker).toContainText(tier === "plus" ? "Thinking" : "High");
    await page.keyboard.press("Escape");
    await geometry(page);
    await page.screenshot({
      path: info.outputPath(`${tier}-selected-model.png`),
      animations: "disabled",
    });
  });
}
